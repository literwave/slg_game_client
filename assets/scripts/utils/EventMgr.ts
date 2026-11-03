
class EventHandler {
    public handler!:Function;
    public target!:object;

    constructor(handler:Function, target:object){
        this.handler = handler;
        this.target = target;
    }
}

class mgr {
    private static _instance: mgr = null;
    private events:Map<string, EventHandler[]> = new Map();
    private targetInName:Map<object, Set<string>> = new Map();

    public static instance(): mgr {
        if (this._instance == null) {
            this._instance = new mgr();
        }
        return this._instance;
    }

    public on(name:string, handler:Function, target:object){
        if(!this.events.has(name)){
            this.events.set(name, []);
        }

        var events = this.events.get(name);
        for (let i = 0; i < events.length; i++) {
            const eh:EventHandler = events[i];
            if(eh.handler == handler && eh.target == target){
                //已经添加过了
                console.log("已经添加过了:", name, handler, target);
                return;
            }
        }

        var eh:EventHandler = new EventHandler(handler, target);
        events.push(eh);

        if(!this.targetInName.has(target)){
            this.targetInName.set(target, new Set())
        }
        var set = this.targetInName.get(target);
        set.add(name);
    }

    public off(name:string, handler:Function, target:object){
        if(!this.events.has(name)){
            return;
        }

        var events = this.events.get(name);
        for (let i = 0; i < events.length; i++) {
            const eh:EventHandler = events[i];
            if(eh.handler == handler && eh.target == target){
                events.splice(i, 1);
                break;
            }
        }
        if (events.length === 0) this.events.delete(name);
        if (!events.some(event => event.target === target)) {
            const names = this.targetInName.get(target);
            if (names) {
                names.delete(name);
                if (names.size === 0) this.targetInName.delete(target);
            }
        }
    }

    public emit(name:string, ...args:any){
        if(!this.events.has(name)){
            return;
        }

        // 回调可以关闭窗口、退订或创建新窗口，不能直接遍历正在变动的数组。
        const events = this.events.get(name).slice();
        for (const eh of events) {
            const current = this.events.get(name);
            if (!current || current.indexOf(eh) < 0) continue;
            if (eh.target && (eh.target as { isValid?: boolean }).isValid === false) {
                this.targetOff(eh.target);
                continue;
            }
            try {
                eh.handler.apply(eh.target, args);
            } catch (error) {
                // 保留错误堆栈，但不能让失效界面吞掉网络回包或其它界面的解锁通知。
                console.error('事件回调执行失败:', name, error);
            }
        }
    }

    public targetOff(target:object){

        if(!this.targetInName.has(target)){
            return;
        }

        var targetInName = this.targetInName.get(target);

        targetInName.forEach(name => {
            if(this.events.has(name)){
               let events = this.events.get(name);
               for (let i = 0; i < events.length; i++) {
                   const eh = events[i];
                   if(eh.target == target){
                        events.splice(i, 1);
                        i = i-1;
                   }
               }
               if (events.length === 0) this.events.delete(name);
            }
        });
        
        targetInName.clear();
        this.targetInName.delete(target);
    }
}

var EventMgr = mgr.instance();
export { EventMgr };
