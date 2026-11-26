import { GameConfig } from '../config/GameConfig';

/** 登录服（login-server）HTTP 接口封装：登录 → 区服列表 → 进服签票 */

export interface LoginAccount { id: string; username: string; channel: string; }

export interface LoginAuthData {
    token: string;
    expire_at: string;
    account: LoginAccount;
    last_server_id?: number;
}

export interface PublicServer {
    server_id: number;
    name: string;
    /** 0 维护 1 正常 2 火爆 3 关闭 */
    status: number;
    gate_addr: string;
    online: number;
    reachable: boolean;
    open_at: string;
    has_role: boolean;
    user_id?: number;
    nickname?: string;
    level?: number;
}

export interface ServerListData { last_server_id?: number; servers: PublicServer[]; }

export interface EnterServerData {
    server_id: number;
    gate_addr: string;
    ticket: string;
    user_id: number;
    account: string;
    expires_in: number;
}

export class LoginApiError extends Error {
    constructor(message: string, public code: number = -1) {
        super(message);
    }
}

const REQUEST_TIMEOUT_MS = 8000;

function request<T>(method: 'GET' | 'POST', path: string, body?: object, token?: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, GameConfig.loginApiUrl + path, true);
        xhr.timeout = REQUEST_TIMEOUT_MS;
        xhr.setRequestHeader('Content-Type', 'application/json');
        if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.onerror = () => reject(new LoginApiError(`无法连接登录服务器 ${GameConfig.loginApiUrl}（${GameConfig.env}），请检查网络`));
        xhr.ontimeout = () => reject(new LoginApiError('登录服务器响应超时，请稍后重试'));
        xhr.onload = () => {
            let payload: any = null;
            try {
                payload = JSON.parse(xhr.responseText);
            } catch {
                reject(new LoginApiError('登录服务器返回了无法识别的数据', xhr.status));
                return;
            }
            if (payload && payload.code === 0) {
                resolve(payload.data as T);
            } else {
                reject(new LoginApiError(payload?.msg || '登录失败', payload?.code ?? xhr.status));
            }
        };
        xhr.send(body ? JSON.stringify(body) : null);
    });
}

export const LoginApi = {
    register(username: string, password: string): Promise<LoginAuthData> {
        return request<LoginAuthData>('POST', '/api/v1/login/register', { username, password });
    },
    auth(username: string, password: string, autoRegister: boolean): Promise<LoginAuthData> {
        return request<LoginAuthData>('POST', '/api/v1/login/auth',
            { username, password, auto_register: autoRegister });
    },
    guest(deviceId: string): Promise<LoginAuthData> {
        return request<LoginAuthData>('POST', '/api/v1/login/guest', { device_id: deviceId });
    },
    /** 未登录即可拉取的区服列表（登录页选服用） */
    serverList(): Promise<ServerListData> {
        return request<ServerListData>('GET', '/api/v1/login/server-list');
    },
    servers(token: string): Promise<ServerListData> {
        return request<ServerListData>('GET', '/api/v1/login/servers', undefined, token);
    },
    enter(token: string, serverId: number): Promise<EnterServerData> {
        return request<EnterServerData>('POST', '/api/v1/login/enter', { server_id: serverId }, token);
    },
};
