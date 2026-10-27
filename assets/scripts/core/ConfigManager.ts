import { JsonAsset, resources } from 'cc';

export default class ConfigManager {
    private static _instance: ConfigManager = null;
    private _configs: { [key: string]: any } = {};
    private _pendingConfigs = new Map<string, Promise<void>>();

    /** 独立打开的功能也等待所需配置，不依赖主界面的初始化时序。 */
    async ensureConfigs(names: string[]): Promise<void> {
        await Promise.all(names.map(name => {
            if (this._configs[name]) return Promise.resolve();
            const pending = this._pendingConfigs.get(name);
            if (pending) return pending;
            const request = new Promise<void>((resolve, reject) => {
                resources.load(`config/${name}`, JsonAsset, (error, asset) => {
                    if (error) { reject(error); return; }
                    if (!asset?.json) { reject(new Error(`配置 ${name} 内容为空`)); return; }
                    this._configs[name] = asset.json;
                    resolve();
                });
            }).then(() => { this._pendingConfigs.delete(name); }, error => {
                this._pendingConfigs.delete(name);
                throw error;
            });
            this._pendingConfigs.set(name, request);
            return request;
        }));
    }

    public static getInstance(): ConfigManager {
        if (!ConfigManager._instance) {
            ConfigManager._instance = new ConfigManager();
        }
        return ConfigManager._instance;
    }

    /**
     * 加载指定目录下的所有 JSON 配置文件
     */
    loadConfigs(data: any[], callback?: (err: Error | null) => void) {
        if (data && Array.isArray(data)) {
            data.forEach(asset => {
                if (asset && asset.name && asset.json) {
                    this._configs[asset.name] = asset.json;
                } else if (asset && asset.json) {
                    this._configs[`config_${Object.keys(this._configs).length}`] = asset.json;
                }
            });
        }

        if (callback) callback(null);
    }


    /**
     * 直接传入 JSON 数据初始化配置
     */
    initConfig(dirAssets: JsonAsset[] | any[], singleAsset?: any) {
        if (dirAssets && Array.isArray(dirAssets)) {
            dirAssets.forEach(asset => {
                if (asset instanceof JsonAsset) {
                    this._configs[asset.name] = asset.json;
                } else {
                    this._configs[`config_${Object.keys(this._configs).length}`] = asset;
                }
            });
        }

        if (singleAsset) {
            if (singleAsset instanceof JsonAsset) {
                this._configs[singleAsset.name] = singleAsset.json;
            } else {
                this._configs[`config_${Object.keys(this._configs).length}`] = singleAsset;
            }
        }
    }

    /**
     * 获取某个配置文件的内容
     */
    getConfig(configName: string): any {
        const config = this._configs[configName];
        if (!config) {
            console.warn(`配置文件 "${configName}" 不存在`);
        }
        return config;
    }

    /**
     * 获取某个配置文件中指定键的值
     */
    getConfigItem(configName: string, key: string): any {
        const config = this.getConfig(configName);
        if (config) {
            return config[key];
        }
        return null;
    }
}
