// /**连接配置*/
//
// 客户端只内置「登录服入口」，游戏网关地址由登录服 /enter 接口下发，不再写死。
// 环境（local / test / prod）解析优先级：
//   1. URL 参数 ?env=test（仅 Web，且允许切换时）
//   2. localStorage 里保存的 game_env（仅允许切换时，可由隐藏入口调用 GameConfig.setEnv 写入）
//   3. 预览/编辑器默认 local，正式构建默认 BUILD_ENV
//
// 正式包请把 BUILD_ENV 保持为 'prod'：此时不允许任何运行时切换，避免玩家误切或被抓包改环境。
// 测试包由 CI 在打包前把 BUILD_ENV 改成 'test'（或用不同的渠道配置覆盖）。

import { sys } from 'cc';
import { PREVIEW } from 'cc/env';

export type GameEnv = 'local' | 'test' | 'prod';

export interface EnvProfile {
    /** 环境显示名 */
    name: string;
    /** 登录服（login-server）HTTP(S) 根地址，不带结尾斜杠 */
    loginApi: string;
    /** 网关协议。正式环境建议前置 TLS 后使用 wss */
    gateScheme: 'ws' | 'wss';
    /** 账号不存在时是否自动注册（仅联调环境开启） */
    autoRegister: boolean;
    /** 其他 Web 服务根地址 */
    webUrl: string;
    /** 登录服没有返回网关地址时的兜底网关（仅本地联调使用） */
    fallbackGateUrl: string;
}

const PROFILES: Record<GameEnv, EnvProfile> = {
    local: {
        name: '本地',
        loginApi: 'http://127.0.0.1:8081',
        gateScheme: 'ws',
        autoRegister: true,
        webUrl: 'http://127.0.0.1:8088',
        fallbackGateUrl: 'ws://127.0.0.1:33022',
    },
    test: {
        name: '测试服',
        // 测试服目前就是本机
        loginApi: 'http://127.0.0.1:8081',
        gateScheme: 'ws',
        autoRegister: true,
        webUrl: 'http://127.0.0.1:8088',
        fallbackGateUrl: 'ws://127.0.0.1:33022',
    },
    prod: {
        name: '正式服',
        // TODO: 公网地址暂留。上线前把 PROD_SERVER_IP 换成正式服公网 IP；有域名和证书后再改成 https / wss
        loginApi: 'http://PROD_SERVER_IP:8081',
        gateScheme: 'ws',
        autoRegister: false,
        webUrl: 'http://PROD_SERVER_IP:8088',
        fallbackGateUrl: '',
    },
};

/** 构建时环境。目前正式服地址还没定，先用 'test'（本机）；上线打正式包前改成 'prod'。 */
const BUILD_ENV: GameEnv = 'test';
const ENV_STORAGE_KEY = 'game_env';

function isGameEnv(value: any): value is GameEnv {
    return value === 'local' || value === 'test' || value === 'prod';
}

/** 非正式构建（或编辑器预览）才允许运行时切换环境 */
function envSwitchAllowed(): boolean {
    return PREVIEW || BUILD_ENV !== 'prod';
}

function readUrlEnv(): GameEnv | null {
    try {
        const loc = (globalThis as any).location;
        const search: string = loc && typeof loc.search === 'string' ? loc.search : '';
        const match = /[?&]env=([a-z]+)/i.exec(search);
        const value = match ? match[1].toLowerCase() : '';
        return isGameEnv(value) ? value : null;
    } catch {
        return null;
    }
}

function readStoredEnv(): GameEnv | null {
    try {
        const value = sys.localStorage.getItem(ENV_STORAGE_KEY);
        return isGameEnv(value) ? value : null;
    } catch {
        return null;
    }
}

function resolveEnv(): GameEnv {
    if (envSwitchAllowed()) {
        const fromUrl = readUrlEnv();
        if (fromUrl) return fromUrl;
        const stored = readStoredEnv();
        if (stored) return stored;
        if (PREVIEW) return 'local';
    }
    return BUILD_ENV;
}

const CURRENT_ENV: GameEnv = resolveEnv();
console.log(`[GameConfig] env=${CURRENT_ENV} loginApi=${PROFILES[CURRENT_ENV].loginApi}`);

const GameConfig = {
    get env(): GameEnv { return CURRENT_ENV; },
    get profile(): EnvProfile { return PROFILES[CURRENT_ENV]; },
    get envSwitchEnabled(): boolean { return envSwitchAllowed(); },
    get loginApiUrl(): string { return PROFILES[CURRENT_ENV].loginApi; },
    get gateScheme(): 'ws' | 'wss' { return PROFILES[CURRENT_ENV].gateScheme; },
    get autoRegister(): boolean { return PROFILES[CURRENT_ENV].autoRegister; },
    get webUrl(): string { return PROFILES[CURRENT_ENV].webUrl; },
    /** 兜底网关地址（仅登录服未下发 gate_addr 时使用） */
    get serverUrl(): string { return PROFILES[CURRENT_ENV].fallbackGateUrl; },

    /** 保存环境选择，重启游戏（刷新页面）后生效。正式包调用无效。 */
    setEnv(env: GameEnv): boolean {
        if (!envSwitchAllowed() || !isGameEnv(env)) return false;
        try {
            sys.localStorage.setItem(ENV_STORAGE_KEY, env);
            return true;
        } catch {
            return false;
        }
    },

    // 排查协议时才开启；避免 Game View 为每个数据包序列化多份日志。
    traceNetworkPackets: false,
};
export { GameConfig };
