import { ISocket } from "./NetInterface";
import * as crypto from "../../libs/crypto/crypto"
import { ProtoManager } from "../pto/ProtoManager";
import { GameConfig } from "../../config/GameConfig";



export class WebSock implements ISocket {
    private _ws: WebSocket = null;              // websocket对象
    private _key: String = "";


    onConnected(event): void {

    }


    onUnpackMessage(typeName: string, data: any) {

    }


    onGetKey() {

    }


    onMessage(msg): void {
        let view: Uint8Array;
        if (msg instanceof ArrayBuffer) {
            view = new Uint8Array(msg);
        } else {
            // 如果是 Blob (某些浏览器默认)，需要转 ArrayBuffer，这里先略过
            return;
        }

        // 格式: [Length(2)][ProtocolID(2)][Protobuf]
        const dv = new DataView(view.buffer);
        const protocolId = dv.getUint16(2, false);
        const protoData = view.slice(4);
        const typeName = ProtoManager.getInstance().getMsgTypeById(protocolId);
        const quiet = !!typeName && typeName.indexOf("heart_beat") >= 0;

        if (typeName) {
            const decoded = ProtoManager.getInstance().decode(typeName, protoData);

            if (decoded) {
                if (GameConfig.traceNetworkPackets && !quiet) {
                    console.debug(`[Network] 收到 ${typeName}，${view.byteLength} 字节`);
                }
                this.onUnpackMessage(typeName, decoded);
            } else {
                console.error(`Failed to decode ${typeName}`);
            }
        } else {
            console.error(`Unknown Protocol ID: ${protocolId}`);
        }

        return;
    }


    onError(event): void {
        console.log("websocket onError:", event)
    }

    onClosed(event): void {
        console.log("websocket onClosed:", event)
    }

    connect(options: any) {
        this.close();

        let url = null;
        if (options.url) {
            url = options.url;
        } else {
            let ip = options.ip;
            let port = options.port;
            let protocol = options.protocol;
            url = `${protocol}://${ip}:${port}`;
        }
        console.log()
        const socket = new WebSocket(url);
        this._ws = socket;
        socket.binaryType = options.binaryType ? options.binaryType : "arraybuffer";
        // 旧连接已经排入浏览器事件队列的回调也必须失效，不能污染下一轮登录。
        socket.onmessage = event => { if (this._ws === socket) this.onMessage(event.data); };
        socket.onopen = event => { if (this._ws === socket) this.onConnected(event); };
        socket.onerror = event => { if (this._ws === socket) this.onError(event); };
        socket.onclose = event => { if (this._ws === socket) this.onClosed(event); };

        return true;
    }

    send(buffer: any) {
        if (this._ws?.readyState == WebSocket.OPEN) {
            this._ws.send(buffer);
            return true;
        }
        return false;
    }

    close(code?: number, reason?: string) {
        this._key = "";
        const socket = this._ws;
        this._ws = null;
        if (!socket) return;
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close(code, reason);
    }


    /**
     * json 加密打包
     * @param send_data 
     */
    /**
     * 打包并发送
     * @param send_data {name: string, msg: any, seq: number}
     */
    /**
     * 打包并发送 (二进制协议)
     * 格式: [包长(2字节)] + [随机数(2字节)] + [Protobuf数据]
     * @param send_data Uint8Array
     */
    public packAndSend(send_data: any) {
        let protoData: Uint8Array | null = null;
        let msgName: string = "";

        if (send_data instanceof Uint8Array) {
            protoData = send_data;
        } else if (send_data.msg && send_data.msg instanceof Uint8Array) {
            protoData = send_data.msg;
            msgName = send_data.name; // 获取消息名称
        }

        if (!protoData) {
            console.error("packAndSend: Expected Uint8Array or {msg: Uint8Array}, got", send_data);
            return;
        }

        const protoLen = protoData.length;

        // 包头长度: 2字节包长 + 2字节 Protocol ID
        // 总长度 = 4 + protoLen
        const totalLen = 4 + protoLen;

        const buffer = new ArrayBuffer(totalLen);
        const view = new DataView(buffer);

        // 1. 写入包长 (2字节)
        // 通常包长指后续数据的长度 (Protocol ID + Proto数据)
        // 也就是 2 + protoLen
        view.setUint16(0, 2 + protoLen, false); // false = Big Endian (网络字节序)

        // 2. 写入 Protocol ID (2字节)
        const quiet = !!msgName && msgName.indexOf("heart_beat") >= 0;
        let protocolId = 0;
        if (msgName) {
            protocolId = ProtoManager.getInstance().getIdByMsgType(msgName);
            if (!protocolId) {
                console.warn(`packAndSend: No Protocol ID found for ${msgName}, using 0`);
            }
        } else {
            console.warn("packAndSend: No msgName provided, using random/0 ID");
            // protocolId = Math.floor(Math.random() * 65535); // 之前是随机数，现在最好不要随机
        }

        view.setUint16(2, protocolId, false);

        // 3. 写入 Protobuf 数据
        const uint8View = new Uint8Array(buffer);
        uint8View.set(protoData, 4);
        if (GameConfig.traceNetworkPackets && !quiet) {
            console.debug(`[Network] 发送 ${msgName}，${totalLen} 字节`);
        }
        // 发送
        this.send(buffer);
    }
}
