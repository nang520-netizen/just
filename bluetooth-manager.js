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
        
        // 传感器参数编号映射（根据您的设备实际调整）
        this.sensorMap = {
            '4102': '土壤温度',
            '4108': '电导率', 
            '4110': '土壤水分'
        };
        
        // 设备蓝牙配置
        this.config = {
            serviceUuid: '49535343-fe7d-4ae5-8fa9-9fafd205e455',
            writeCharUuid: '49535343-8841-43f4-a8d4-ecbe34729bb3',
            notifyCharUuid: '49535343-1e4d-4bd9-ba61-23c647249616'
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
            this.service = await this.server.getPrimaryService(this.config.serviceUuid);
            console.log('获取服务成功');
            
            // 获取写特征值
            this.writeChar = await this.service.getCharacteristic(this.config.writeCharUuid);
            console.log('获取写特征值成功');
            
            // 获取通知特征值并启用通知
            this.notifyChar = await this.service.getCharacteristic(this.config.notifyCharUuid);
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
     * 处理蓝牙数据返回
     */
    handleData(event) {
        const value = event.target.value;
        const decoder = new TextDecoder();
        const str = decoder.decode(value);
        
        console.log('收到数据片段:', str);
        
        this.dataCache += str;
        
        // 判断是否收到完整数据（以\r\nok\r\n结尾）
        const completeFlag = /\r\nok\r\n$/i;
        if (completeFlag.test(this.dataCache)) {
            console.log('收到完整响应');
            
            // 提取JSON部分
            const jsonMatch = this.dataCache.match(/\{.*\}/s);
            
            if (jsonMatch && this.resolveCallback) {
                try {
                    const jsonData = JSON.parse(jsonMatch[0]);
                    console.log('解析JSON成功:', jsonData);
                    this.resolveCallback(jsonData);
                } catch (e) {
                    console.error('JSON解析失败:', e);
                    if (window.log) {
                        window.log(`JSON解析失败，原始数据: "${this.dataCache}"`, 'error');
                    }
                    this.resolveCallback(null, e);
                }
            } else if (!jsonMatch) {
                console.error('未找到JSON数据');
                if (window.log) {
                    window.log(`未找到JSON数据，原始内容: "${this.dataCache}"`, 'error');
                }
                if (this.resolveCallback) {
                    this.resolveCallback(null, new Error('未找到JSON数据'));
                }
            }
            
            this.dataCache = ''; // 清空缓存
            this.resolveCallback = null;
        }
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

            // 设置回调
            this.resolveCallback = (result, error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            };

            // 构建完整指令
            let fullCommand = `AT+${command}`;
            if (data !== null) {
                fullCommand += `=${JSON.stringify(data)}`;
            }
            fullCommand += '\r\n';

            console.log('发送指令:', fullCommand);
            if (window.log) {
                window.log(`发送指令: AT+${command}`, 'info');
            }

            // 发送数据
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

            // 5秒超时
            setTimeout(() => {
                if (this.resolveCallback) {
                    this.resolveCallback = null;
                    reject(new Error('指令响应超时'));
                }
            }, 5000);
        });
    }

    /**
     * 获取传感器数据（适配实际设备格式）
     */
    async getSensorData() {
        try {
            if (window.log) {
                window.log('正在发送 AT+MEA=? 指令...', 'info');
            }
            
            const result = await this.sendATCommand('MEA=?');
            
            if (window.log) {
                window.log(`收到完整响应: ${JSON.stringify(result)}`, 'success');
            }

            // 🎯 适配新数据格式：{"4102":"24300.0","4108":"O.00","4110":"O.0"}
            if (!result || typeof result !== 'object') {
                throw new Error('设备返回了无效数据');
            }

            // 解析所有传感器参数
            const sensorData = [];
            const sensorLabels = [];
            
            for (const [key, value] of Object.entries(result)) {
                // 跳过非传感器字段
                if (!this.sensorMap[key]) continue;
                
                const label = this.sensorMap[key];
                sensorLabels.push(label);
                
                // 处理数值和错误状态
                let numericValue = null;
                
                if (value === 'O.00' || value === 'O.0' || value === 'O') {
                    // 固件bug：错误状态用了字母O而不是数字0
                    if (window.log) {
                        window.log(`${label}: 传感器离线 (O错误码)`, 'error');
                    }
                    numericValue = null;
                } else if (value === '2000001' || value === '2000003') {
                    // 标准错误码
                    if (window.log) {
                        window.log(`${label}: 测量错误 (${value})`, 'error');
                    }
                    numericValue = null;
                } else {
                    // 正常数值（字符串形式）
                    numericValue = parseFloat(value);
                    if (isNaN(numericValue)) {
                        if (window.log) {
                            window.log(`${label}: 无效数值 "${value}"`, 'error');
                        }
                        numericValue = null;
                    } else {
                        // 除以1000还原真实值
                        numericValue = numericValue / 1000;
                        if (window.log) {
                            window.log(`${label}: ${numericValue.toFixed(3)}`, 'success');
                        }
                    }
                }
                
                sensorData.push(numericValue);
            }

            if (sensorData.length === 0) {
                throw new Error('未找到任何有效的传感器数据');
            }

            return {
                data: sensorData,
                labels: sensorLabels
            };
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

    /**
     * 配置设备参数
     */
    async configDevice(config) {
        return await this.sendATCommand('CONFIG', config);
    }

    /**
     * 恢复出厂设置（谨慎使用）
     */
    async restoreFactory() {
        return await this.sendATCommand('RESTORE');
    }
}

// 创建全局实例
const bluetoothManager = new BluetoothManager();

