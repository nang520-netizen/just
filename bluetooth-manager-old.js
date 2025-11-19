class BluetoothManager {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.writeChar = null;
        this.notifyChar = null;
        this.isConnected = false;
        this.dataCache = '';
        this.resolveCallback = null;
        
        // ✅ 基于 Seeed 文档的旧款设备参数映射
        this.sensorMap = {
            '4102': { name: '土壤湿度', unit: '%', factor: 1000 },
            '4103': { name: '土壤温度', unit: '℃', factor: 1000 },
            '4104': { name: '电池电量', unit: '%', factor: 1 },
            '4108': { name: '土壤电导率', unit: 'μS/cm', factor: 1000 },
            '4110': { name: '土壤pH值', unit: 'pH', factor: 100 }
        };
    }

    /**
     * 连接设备
     */
    async connect(device) {
        try {
            console.log('开始连接GATT服务器...');
            this.device = device;
            
            // 连接GATT服务器
            this.server = await device.gatt.connect();
            console.log('GATT服务器连接成功');
            
            // 获取主服务
            this.service = await this.server.getPrimaryService('49535343-fe7d-4ae5-8fa9-9fafd205e455');
            console.log('获取服务成功');
            
            // 获取写特征值
            this.writeChar = await this.service.getCharacteristic('49535343-8841-43f4-a8d4-ecbe34729bb3');
            console.log('获取写特征值成功');
            
            // 获取通知特征值并启用通知
            this.notifyChar = await this.service.getCharacteristic('49535343-1e4d-4bd9-ba61-23c647249616');
            await this.notifyChar.startNotifications();
            console.log('启动通知成功');
            
            // 监听数据返回
            this.notifyChar.addEventListener('characteristicvaluechanged', this.handleData.bind(this));
            
            // 监听设备断开
            this.device.addEventListener('gattserverdisconnected', this.handleDisconnect.bind(this));
            
            this.isConnected = true;
            return true;
        } catch (error) {
            console.error('连接过程失败:', error);
            throw error;
        }
    }

    /**
     * 断开连接
     */
    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        }
        this.cleanup();
    }

    /**
     * 清理资源
     */
    cleanup() {
        this.isConnected = false;
        this.device = null;
        this.server = null;
        this.service = null;
        this.writeChar = null;
        if (this.notifyChar) {
            this.notifyChar.stopNotifications().catch(e => console.error('停止通知失败:', e));
            this.notifyChar.removeEventListener('characteristicvaluechanged', this.handleData.bind(this));
            this.notifyChar = null;
        }
        this.dataCache = '';
        this.resolveCallback = null;
    }

    /**
     * 处理设备断开
     */
    handleDisconnect() {
        console.log('设备已断开');
        this.cleanup();
        if (window.updateConnectionStatus) {
            window.updateConnectionStatus(false);
        }
    }

    /**
     * 处理蓝牙数据返回（超强兼容版）
     */
    handleData(event) {
        const value = event.target.value;
        const decoder = new TextDecoder();
        const str = decoder.decode(value);
        
        console.log('收到数据片段:', str);
        
        if (window.log) {
            window.log(`收到数据: "${str}"`, 'info');
        }
        
        this.dataCache += str;
        
        // 判断是否收到完整数据（以\r\nok\r\n结尾）
        const completeFlag = /\r\nok\r\n$/i;
        if (completeFlag.test(this.dataCache)) {
            console.log('收到完整响应');
            
            // 提取JSON部分
            let jsonMatch = this.dataCache.match(/\{.*\}/s);
            
            if (jsonMatch && this.resolveCallback) {
                try {
                    const jsonData = JSON.parse(jsonMatch[0]);
                    console.log('JSON解析成功:', jsonData);
                    this.resolveCallback(jsonData);
                } catch (e) {
                    console.log('JSON解析失败，尝试文本解析');
                    this.parseAsText(this.dataCache);
                }
            } else if (this.resolveCallback) {
                console.log('未找到JSON，直接文本解析');
                this.parseAsText(this.dataCache);
            }
            
            this.dataCache = '';
            this.resolveCallback = null;
        }
    }

    /**
     * 文本解析器（超强兼容）
     */
    parseAsText(rawText) {
        console.log('开始文本解析，原始数据:', rawText);
        
        if (window.log) {
            window.log(`使用文本解析器: "${rawText}"`, 'info');
        }
        
        try {
            let dataObject = {};
            
            // 方法1：尝试修复JSON
            try {
                const cleaned = rawText.replace(/([{,]\s*)(\w+):/g, '$1"$2":')
                                      .replace(/:\s*O\.?0*\s*([,}])/g, ':"O.00"$1')
                                      .replace(/\r\nok\r\n/g, '')
                                      .trim();
                
                if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
                    dataObject = JSON.parse(cleaned);
                }
            } catch (e) {
                console.log('清理后JSON解析失败:', e);
            }
            
            // 方法2：CSV解析
            if (Object.keys(dataObject).length === 0) {
                const csvMatch = rawText.match(/([\d.]+|O\.?\d*)/g);
                if (csvMatch) {
                    console.log('CSV解析成功:', csvMatch);
                    const keys = ['4102', '4103', '4104', '4108', '4110'];
                    csvMatch.forEach((val, idx) => {
                        if (keys[idx]) {
                            dataObject[keys[idx]] = val;
                        }
                    });
                }
            }
            
            console.log('最终解析结果:', dataObject);
            const converted = this.convertToStandardFormat(dataObject);
            
            if (this.resolveCallback) {
                this.resolveCallback(converted);
            }
            
        } catch (error) {
            console.error('文本解析失败:', error);
            if (window.log) {
                window.log(`文本解析失败: ${error.message}`, 'error');
            }
            if (this.resolveCallback) {
                this.resolveCallback(null, error);
            }
        }
    }

    /**
     * 转换为标准格式
     */
    convertToStandardFormat(rawData) {
        const dataArray = [];
        const labelArray = [];
        
        // 📊 动态解析所有返回的参数
        for (const [key, rawValue] of Object.entries(rawData)) {
            if (!this.sensorMap[key]) {
                console.log(`未知参数 ${key}: ${rawValue}`);
                if (window.log) {
                    window.log(`未知传感器参数 ${key}: ${rawValue}`, 'info');
                }
                continue;
            }

            const sensorInfo = this.sensorMap[key];
            labelArray.push(`${sensorInfo.name} (${sensorInfo.unit})`);
            
            let value = null;
            
            // 错误码处理
            if (rawValue === 'O.00' || rawValue === 'O.0' || rawValue === 'O' || 
                rawValue === '2000001' || rawValue === '2000003') {
                value = null;
                if (window.log) {
                    window.log(`${sensorInfo.name}: 传感器离线/错误`, 'error');
                }
            } else {
                // 正常数值转换
                const numValue = parseFloat(rawValue);
                if (isNaN(numValue)) {
                    value = null;
                } else {
                    value = numValue / sensorInfo.factor;
                    if (window.log) {
                        window.log(`${sensorInfo.name}: ${value.toFixed(3)} ${sensorInfo.unit}`, 'success');
                    }
                }
            }
            
            dataArray.push(value);
        }

        return {
            data: dataArray,
            labels: labelArray
        };
    }

    /**
     * 发送AT指令
     */
    async sendATCommand(command, data = null) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('设备未连接'));
                return;
            }

            this.resolveCallback = (result, error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            };

            let fullCommand = `AT+${command}`;
            if (data !== null) {
                fullCommand += `=${JSON.stringify(data)}`;
            }
            fullCommand += '\r\n';

            console.log('发送指令:', fullCommand);
            if (window.log) {
                window.log(`发送指令: AT+${command}`, 'info');
            }

            const encoder = new TextEncoder();
            const buffer = encoder.encode(fullCommand);
            
            this.writeChar.writeValue(buffer)
                .then(() => {
                    console.log('指令发送成功');
                })
                .catch(err => {
                    console.error('指令发送失败:', err);
                    reject(err);
                });

            setTimeout(() => {
                if (this.resolveCallback) {
                    this.resolveCallback = null;
                    reject(new Error('指令响应超时'));
                }
            }, 5000);
        });
    }

    /**
     * 获取传感器数据
     */
    async getSensorData() {
        try {
            if (window.log) {
                window.log('正在获取传感器数据（文档标准版）...', 'info');
            }
            
            const result = await this.sendATCommand('MEA=?');
            
            if (window.log) {
                window.log(`完整响应: ${JSON.stringify(result)}`, 'success');
            }
            
            if (!result || !Array.isArray(result.data)) {
                throw new Error(`数据格式错误：${JSON.stringify(result)}`);
            }
            
            return result;
        } catch (error) {
            console.error('获取传感器数据失败:', error);
            if (window.log) {
                window.log(`测量过程出错: ${error.message}`, 'error');
            }
            throw error;
        }
    }

    /**
     * 获取设备信息
     */
    async getDeviceInfo() {
        return await this.sendATCommand('INFO=?');
    }

    /**
     * 获取传感器列表
     */
    async getSensorList() {
        return await this.sendATCommand('SENSOR=?');
    }
}

// 创建全局实例
const bluetoothManager = new BluetoothManager();
