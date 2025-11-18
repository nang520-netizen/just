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
        
        // 旧款设备参数映射（根据实际调整）
        this.sensorMap = {
            '4102': '土壤湿度1',
            '4108': '土壤湿度2', 
            '4110': '土壤温度'
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
     * 处理蓝牙数据返回（兼容非JSON格式）
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
            
            // 提取JSON部分（如果有）
            let jsonMatch = this.dataCache.match(/\{.*\}/s);
            
            if (jsonMatch && this.resolveCallback) {
                try {
                    const jsonData = JSON.parse(jsonMatch[0]);
                    console.log('JSON解析成功:', jsonData);
                    this.resolveCallback(jsonData);
                } catch (e) {
                    console.log('JSON解析失败，尝试文本解析');
                    // 🔧 旧款设备兼容：尝试作为纯文本解析
                    this.parseAsText(this.dataCache);
                }
            } else if (this.resolveCallback) {
                // 完全没有JSON格式，直接文本解析
                console.log('未找到JSON，直接文本解析');
                this.parseAsText(this.dataCache);
            }
            
            this.dataCache = ''; // 清空缓存
            this.resolveCallback = null;
        }
    }

    /**
     * 文本解析器（兼容旧款设备）
     */
    parseAsText(rawText) {
        console.log('开始文本解析，原始数据:', rawText);
        
        if (window.log) {
            window.log(`使用文本解析器: "${rawText}"`, 'info');
        }
        
        try {
            // 尝试提取数值（支持多种格式）
            // 格式1: {"4102":"24300.0","4108":"O.00","4110":"O.0"}（带引号）
            // 格式2: {4102:24300.0,4108:O.00,4110:O.0}（不带引号）
            // 格式3: 24300.0,O.0,25.1（纯CSV）
            
            let dataObject = {};
            
            // 方法1：尝试清理后当JSON解析
            try {
                // 移除可能的非法字符
                const cleaned = rawText.replace(/([{,]\s*)(\w+):/g, '$1"$2":') // 给key加引号
                                      .replace(/:\s*O\.?0*\s*([,}])/g, ':"O.00"$1') // 处理O错误码
                                      .replace(/\r\nok\r\n/g, '') // 移除结束符
                                      .trim();
                
                if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
                    dataObject = JSON.parse(cleaned);
                }
            } catch (e) {
                console.log('清理后JSON解析失败:', e);
            }
            
            // 方法2：如果还是失败，尝试CSV解析
            if (Object.keys(dataObject).length === 0) {
                const csvMatch = rawText.match(/([\d.]+|O\.?\d*)/g);
                if (csvMatch) {
                    console.log('CSV解析成功:', csvMatch);
                    // 给CSV数据分配默认key
                    csvMatch.forEach((val, idx) => {
                        const keys = ['4102', '4108', '4110'];
                        if (keys[idx]) {
                            dataObject[keys[idx]] = val;
                        }
                    });
                }
            }
            
            console.log('最终解析结果:', dataObject);
            
            // 转换为标准格式
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
        
        // 按已知key顺序提取
        const keyOrder = ['4102', '4108', '4110'];
        
        keyOrder.forEach(key => {
            if (rawData.hasOwnProperty(key)) {
                const rawValue = rawData[key];
                const label = this.sensorMap[key] || `传感器${key}`;
                labelArray.push(label);
                
                let value = null;
                
                // 处理各种错误格式
                if (rawValue === 'O.00' || rawValue === 'O.0' || rawValue === 'O') {
                    // 字母O错误码
                    value = null;
                } else if (rawValue === '2000001' || rawValue === '2000003') {
                    // 标准错误码
                    value = null;
                } else {
                    // 正常数值
                    value = parseFloat(rawValue);
                    if (isNaN(value)) {
                        value = null;
                    } else {
                        value = value / 1000; // 除以1000
                    }
                }
                
                dataArray.push(value);
            }
        });
        
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
     * 获取传感器数据（旧款兼容版）
     */
    async getSensorData() {
        try {
            if (window.log) {
                window.log('正在获取旧设备传感器数据（兼容模式）...', 'info');
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
