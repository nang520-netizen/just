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
        
        // ✅ Seeed文档标准参数映射
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
     * 处理蓝牙数据返回（跳过JSON解析）
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
            
            // 🚀 直接提取键值对，不依赖JSON.parse
            const result = this.extractKeyValuePairs(this.dataCache);
            
            if (this.resolveCallback) {
                this.resolveCallback(result);
            }
            
            this.dataCache = '';
            this.resolveCallback = null;
        }
    }

    /**
     * 从原始字符串直接提取键值对（核心函数）
     */
    extractKeyValuePairs(rawText) {
        console.log('开始提取键值对，原始文本:', rawText);
        
        const cleanText = rawText.replace(/\r\nok\r\n/g, '').trim();
        console.log('清理后文本:', cleanText);
        
        const dataObject = {};
        
        // 正则表达式匹配模式：支持 "4102":"24300.0" 或 4102:24300.0 或 4102=24300.0
        const pattern = /([0-9]{4})\s*[:=]\s*"*([A-Za-z0-9.]+)"*/g;
        let match;
        
        while ((match = pattern.exec(cleanText)) !== null) {
            const key = match[1]; // 4102, 4103 等
            const value = match[2]; // 24300.0, O.00 等
            
            console.log(`提取到: ${key} = ${value}`);
            if (window.log) {
                window.log(`提取参数 ${key}: ${value}`, 'info');
            }
            
            dataObject[key] = value;
        }
        
        // 如果正则没匹配到，尝试更宽松的提取
        if (Object.keys(dataObject).length === 0) {
            console.log('严格模式未匹配到，尝试宽松模式');
            const loosePattern = /([0-9]{4})\D+([0-9.A-Za-z]+)/g;
            while ((match = loosePattern.exec(cleanText)) !== null) {
                const key = match[1];
                const value = match[2];
                if (key && value) {
                    dataObject[key] = value;
                }
            }
        }
        
        console.log('提取结果:', dataObject);
        
        // 转换为标准结构
        return this.convertToStructure(dataObject);
    }

    /**
     * 转换为标准结构
     */
    convertToStructure(rawData) {
        console.log('开始转换结构，提取的数据:', rawData);
        
        if (!rawData || Object.keys(rawData).length === 0) {
            throw new Error('未提取到任何传感器数据');
        }
        
        const dataArray = [];
        const labelArray = [];
        
        // 遍历提取的数据
        for (const [key, rawValue] of Object.entries(rawData)) {
            // 验证key是否在映射表中
            const sensorInfo = this.sensorMap[key];
            
            if (!sensorInfo) {
                console.warn(`未知参数标识符: ${key} = ${rawValue}`);
                if (window.log) {
                    window.log(`未知传感器参数 ${key}: ${rawValue}`, 'info');
                }
                continue;
            }
            
            const label = `${sensorInfo.name} (${sensorInfo.unit})`;
            labelArray.push(label);
            
            console.log(`处理 ${key}: ${rawValue} → ${label}`);
            
            let value = null;
            
            // 统一错误判断
            const errorCodes = ['ERROR', 'O.00', 'O.0', 'O', '2000001', '2000003', '0.00', ''];
            if (errorCodes.includes(rawValue)) {
                value = null;
                if (window.log) {
                    window.log(`❌ ${label}: 传感器离线/错误`, 'error');
                }
            } else {
                // 转换数值
                const numValue = parseFloat(rawValue);
                if (isNaN(numValue)) {
                    console.error(`无效数值: ${rawValue}`);
                    value = null;
                } else {
                    value = numValue / sensorInfo.factor;
                    console.log(`✅ 转换结果: ${value}`);
                    if (window.log) {
                        window.log(`${label}: ${value.toFixed(3)} ${sensorInfo.unit}`, 'success');
                    }
                }
            }
            
            dataArray.push(value);
        }
        
        // 确保有数据
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
     * 获取传感器数据
     */
    async getSensorData() {
        try {
            if (window.log) {
                window.log('正在获取传感器数据（正则提取版）...', 'info');
            }
            
            const result = await this.sendATCommand('MEA=?');
            
            if (window.log) {
                window.log(`完整响应: ${JSON.stringify(result)}`, 'success');
                window.log(`有效传感器数量: ${result.data.length}`, 'success');
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
