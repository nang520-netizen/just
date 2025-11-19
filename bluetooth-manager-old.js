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
            '4102': { name: '土壤湿度', unit: '%', factor: 1000, type: 'moisture' },
            '4103': { name: '土壤温度', unit: '℃', factor: 1000, type: 'temperature' },
            '4104': { name: '电池电量', unit: '%', factor: 1, type: 'battery' },
            '4108': { name: '土壤电导率', unit: 'μS/cm', factor: 1000, type: 'conductivity' },
            '4110': { name: '土壤pH值', unit: 'pH', factor: 100, type: 'ph' }
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
            
            let jsonMatch = this.dataCache.match(/\{.*\}/s);
            
            if (jsonMatch && this.resolveCallback) {
                try {
                    const jsonData = JSON.parse(jsonMatch[0]);
                    console.log('JSON解析成功:', jsonData);
                    this.resolveCallback(jsonData);
                } catch (e) {
                    console.log('JSON解析失败，尝试文本修复');
                    this.parseWithTextRecovery(this.dataCache);
                }
            } else if (this.resolveCallback) {
                console.log('未找到JSON，使用文本修复');
                this.parseWithTextRecovery(this.dataCache);
            }
            
            this.dataCache = '';
            this.resolveCallback = null;
        }
    }

    /**
     * 文本修复解析器（核心修复）
     */
    parseWithTextRecovery(rawText) {
        console.log('开始文本修复解析，原始数据:', rawText);
        
        if (window.log) {
            window.log(`使用修复解析器: "${rawText}"`, 'info');
        }
        
        try {
            let dataObject = null;
            
            // 🔧 方法1：强力JSON修复
            try {
                // 步骤1：移除结束符和空白
                let cleaned = rawText.replace(/\r\nok\r\n/g, '').trim();
                
                // 步骤2：修复未加引号的key
                cleaned = cleaned.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
                
                // 步骤3：修复单引号为双引号
                cleaned = cleaned.replace(/'/g, '"');
                
                // 步骤4：修复O错误码（字母O替换为字符串"ERROR"）
                cleaned = cleaned.replace(/:\s*"*O\.?\d*"*/g, ':"ERROR"');
                
                // 步骤5：修复数值格式（确保小数点正确）
                cleaned = cleaned.replace(/,\s*([}\]])/g, '"":null$1'); // 处理空值
                
                console.log('修复后的JSON字符串:', cleaned);
                
                if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
                    dataObject = JSON.parse(cleaned);
                    console.log('修复后JSON解析成功:', dataObject);
                }
            } catch (e) {
                console.log('JSON修复失败:', e);
            }
            
            // 如果修复成功，转换为标准格式
            if (dataObject && Object.keys(dataObject).length > 0) {
                const converted = this.convertToStandardFormat(dataObject);
                if (this.resolveCallback) {
                    this.resolveCallback(converted);
                }
            } else {
                throw new Error('数据修复失败，无法识别设备数据格式');
            }
            
        } catch (error) {
            console.error('文本修复解析失败:', error);
            if (window.log) {
                window.log(`修复解析失败: ${error.message}`, 'error');
            }
            if (this.resolveCallback) {
                this.resolveCallback(null, error);
            }
        }
    }

    /**
     * 转换为标准格式（带调试日志）
     */
    convertToStandardFormat(rawData) {
        console.log('开始转换，原始数据对象:', rawData);
        
        const dataArray = [];
        const labelArray = [];
        
        // 遍历原始数据
        for (const [key, rawValue] of Object.entries(rawData)) {
            // ✅ 验证key是否在映射表中
            if (!this.sensorMap[key]) {
                console.warn(`跳过未知参数 ${key}: ${rawValue}`);
                if (window.log) {
                    window.log(`跳过未知参数 ${key}: ${rawValue}`, 'info');
                }
                continue;
            }

            const sensorInfo = this.sensorMap[key];
            const displayName = `${sensorInfo.name} (${sensorInfo.unit})`;
            labelArray.push(displayName);
            
            console.log(`处理 ${key}: ${rawValue} → ${displayName}`);
            
            let value = null;
            
            // 统一错误码判断（字母O或数字0）
            const errorPattern = /^(O\.?0*|0\.?0*|2000001|2000003|ERROR)$/i;
            if (errorPattern.test(rawValue)) {
                value = null;
                if (window.log) {
                    window.log(`${displayName}: 传感器离线/错误`, 'error');
                }
            } else {
                // 解析数值
                const numValue = parseFloat(rawValue);
                if (isNaN(numValue)) {
                    console.error(`无效数值: ${rawValue}`);
                    value = null;
                } else {
                    // 应用转换因子
                    value = numValue / sensorInfo.factor;
                    console.log(`转换后: ${value}`);
                    if (window.log) {
                        window.log(`${displayName}: ${value.toFixed(3)} ${sensorInfo.unit}`, 'success');
                    }
                }
            }
            
            dataArray.push(value);
        }

        console.log('转换完成:', { data: dataArray, labels: labelArray });
        
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
                window.log('正在获取传感器数据（文档标准映射）...', 'info');
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
