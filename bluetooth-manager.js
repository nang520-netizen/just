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
     * 处理蓝牙数据返回（增强版）
     */
    handleData(event) {
        const value = event.target.value;
        const decoder = new TextDecoder();
        const str = decoder.decode(value);
        
        console.log('收到数据片段:', str);
        
        // 📝 实时显示原始数据到日志
        if (window.log) {
            window.log(`收到数据: "${str}"`, 'info');
        }
        
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
                    // 🔍 显示解析失败的原始数据
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
     * 发送AT指令（增强版）
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
     * 获取传感器数据（超强调试版）
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
            
            // 🔍 增强的数据格式验证
            if (!result) {
                throw new Error('设备返回了空数据');
            }
            
            if (!result.data) {
                console.error('返回数据没有 "data" 字段:', result);
                throw new Error(`数据格式错误：缺少 'data' 字段。原始数据: ${JSON.stringify(result)}`);
            }
            
            if (!Array.isArray(result.data)) {
                console.error('data 字段不是数组:', result.data);
                throw new Error(`数据格式错误：'data' 必须是数组。实际类型: ${typeof result.data}`);
            }
            
            // 处理数据（设备返回的值乘以1000，app需要除以1000）
            result.data = result.data.map((value, index) => {
                console.log(`传感器 ${index} 原始值: ${value}`);
                
                // 错误码处理
                if (value === 2000001 || value === 2000003) {
                    if (window.log) {
                        window.log(`传感器 ${index + 1}: 测量错误`, 'error');
                    }
                    return null; // 错误值
                }
                
                // 除以1000还原真实值
                const realValue = value / 1000;
                if (window.log) {
                    window.log(`传感器 ${index + 1}: ${realValue.toFixed(3)}`, 'success');
                }
                return realValue;
            });
            
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
