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
        
        // ✅ Seeed文档标准参数映射（含修正因子）
        this.sensorMap = {
            '4102': { name: '土壤湿度', unit: '%', factor: 1000, key: 'soil_moisture' },
            '4103': { name: '土壤温度', unit: '℃', factor: 1000, key: 'soil_temperature' },
            '4104': { name: '电池电量', unit: '%', factor: 1, key: 'battery' },
            '4108': { name: '土壤电导率', unit: 'μS/cm', factor: 1000, key: 'conductivity' },
            '4110': { name: '土壤pH值', unit: 'pH', factor: 100, key: 'ph' }
        };
    }

    /**
     * 连接设备
     */
    async connect(device) {
        try {
            console.log('开始连接GATT服务器...');
            this.device = device;
            
            this.server = await device.gatt.connect();
            console.log('GATT服务器连接成功');
            
            this.service = await this.server.getPrimaryService('49535343-fe7d-4ae5-8fa9-9fafd205e455');
            console.log('获取服务成功');
            
            this.writeChar = await this.service.getCharacteristic('49535343-8841-43f4-a8d4-ecbe34729bb3');
            console.log('获取写特征值成功');
            
            this.notifyChar = await this.service.getCharacteristic('49535343-1e4d-4bd9-ba61-23c647249616');
            await this.notifyChar.startNotifications();
            console.log('启动通知成功');
            
            this.notifyChar.addEventListener('characteristicvaluechanged', this.handleData.bind(this));
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
     * 处理蓝牙数据返回（超强纠错版）
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
        
        const completeFlag = /\r\nok\r\n$/i;
        if (completeFlag.test(this.dataCache)) {
            console.log('收到完整响应，原始数据:', this.dataCache);
            
            // 🔥 提取第一个完整的JSON对象
            const jsonMatches = this.dataCache.match(/\{.*?\}(?=\r\nok\r\n)/gs);
            
            if (jsonMatches && jsonMatches.length > 0) {
                const firstJsonStr = jsonMatches[0];
                console.log('提取第一个JSON:', firstJsonStr);
                
                try {
                    const jsonData = JSON.parse(firstJsonStr);
                    console.log('JSON解析成功:', jsonData);
                    if (this.resolveCallback) {
                        this.resolveCallback(jsonData);
                    }
                } catch (e) {
                    console.log('JSON解析失败，尝试恢复解析');
                    this.parseWithRecovery(firstJsonStr);
                }
            } else {
                console.log('未提取到JSON，尝试文本解析');
                const cleanText = this.dataCache.replace(/\r\nok\r\n/g, '').trim();
                this.parseWithRecovery(cleanText);
            }
            
            this.dataCache = ''; // 立即清空缓存
            this.resolveCallback = null;
        }
    }

    /**
     * 恢复解析器（最终版）
     */
    parseWithRecovery(malformedJson) {
        console.log('开始恢复解析:', malformedJson);
        
        if (window.log) {
            window.log(`使用恢复解析器: "${malformedJson}"`, 'info');
        }
        
        try {
            // 步骤1：确保是有效JSON格式
            if (!malformedJson.startsWith('{') || !malformedJson.endsWith('}')) {
                malformedJson = `{${malformedJson}}`;
            }
            
            // 步骤2：修复键名（加引号）
            let fixed = malformedJson.replace(/([{,]\s*)([a-zA-Z0-9]+)(\s*:)/g, '$1"$2"$3');
            
            // 步骤3：修复值（确保是字符串）
            fixed = fixed.replace(/:\s*([A-Za-z]+[A-Za-z0-9.]*)/g, ': "$1"');
            fixed = fixed.replace(/:\s*(\d+\.?\d*)\s*([,}])/g, ': "$1"$2');
            
            // 步骤4：处理O错误码
            fixed = fixed.replace(/:\s*"O\.?\d*"/gi, ':"ERROR"');
            
            console.log('修复后的JSON字符串:', fixed);
            
            if (window.log) {
                window.log(`修复后JSON: ${fixed}`, 'info');
            }
            
            const dataObject = JSON.parse(fixed);
            console.log('JSON解析成功:', dataObject);
            
            const converted = this.convertToStandardStructure(dataObject);
            
            if (this.resolveCallback) {
                this.resolveCallback(converted);
            }
            
        } catch (error) {
            console.error('恢复解析失败:', error);
            if (window.log) {
                window.log(`恢复解析失败: ${error.message}。原始数据: "${malformedJson}"`, 'error');
            }
            if (this.resolveCallback) {
                this.resolveCallback(null, new Error(`数据修复失败：${error.message}`));
            }
        }
    }

    /**
     * 转换为标准结构（带验证）
     */
    convertToStandardStructure(rawData) {
        console.log('开始转换结构，原始数据:', rawData);
        
        const dataArray = [];
        const labelArray = [];
        
        // 验证输入
        if (!rawData || typeof rawData !== 'object') {
            throw new Error('无效的数据对象');
        }
        
        // 遍历对象
        for (const [key, value] of Object.entries(rawData)) {
            console.log(`处理键值对: ${key} = ${value}`);
            
            // 验证key
            const sensorInfo = this.sensorMap[key];
            
            if (!sensorInfo) {
                console.warn(`未知参数标识符 ${key}: ${value}`);
                if (window.log) {
                    window.log(`未知传感器参数 ${key}: ${value}`, 'info');
                }
                continue;
            }
            
            const label = `${sensorInfo.name} (${sensorInfo.unit})`;
            labelArray.push(label);
            
            let numericValue = null;
            
            // 统一错误判断
            const errorCodes = ['ERROR', 'O.00', 'O.0', 'O', '2000001', '2000003', '0.00', ''];
            if (value === null || errorCodes.includes(value)) {
                numericValue = null;
                if (window.log) {
                    window.log(`❌ ${label}: 传感器离线/错误`, 'error');
                }
            } else {
                // 转换数值
                const numValue = parseFloat(value);
                if (isNaN(numValue)) {
                    console.error(`无效数值: ${value}`);
                    numericValue = null;
                } else {
                    numericValue = numValue / sensorInfo.factor;
                    console.log(`✅ 转换结果: ${numericValue}`);
                    if (window.log) {
                        window.log(`${label}: ${numericValue.toFixed(3)} ${sensorInfo.unit}`, 'success');
                    }
                }
            }
            
            dataArray.push(numericValue);
        }

        // 验证结果
        if (dataArray.length === 0) {
            throw new Error('未找到任何有效的传感器数据');
        }
        
        const result = { data: dataArray, labels: labelArray };
        console.log('转换完成:', result);
        return result;
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
     * 获取传感器数据（最终版）
     */
    async getSensorData() {
        try {
            if (window.log) {
                window.log('正在获取传感器数据（终极修复版）...', 'info');
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
}

// 创建全局实例
const bluetoothManager = new BluetoothManager();
