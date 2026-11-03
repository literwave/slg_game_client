
import { _decorator, Component, Label, Button } from 'cc';
import { AudioManager } from '../../common/AudioManager';
import DialogView from './DialogView';
const {ccclass, property} = _decorator;

export class DialogType {
    public static Default:number = 0;
    public static OnlyCancel:number = 1;
    public static OnlyConfirm:number = 2;
}

@ccclass('Dialog')
export default class Dialog extends Component {

    @property(Label)
    text: Label = null;

    @property(Button)
    confirmBtn: Button = null;

    @property(Button)
    cancelBtn: Button = null;

    protected closeCB: Function = null;
    protected confirmCB: Function = null;
    protected cancelCB: Function = null;
    private dialogView: DialogView = null;

    protected onLoad(): void {
        this.prepare();
    }

    protected onEnable(): void {
        this.dialogView?.refreshSize();
    }

    protected onDestroy(): void {
        this.dialogView?.dispose();
        this.closeCB = this.confirmCB = this.cancelCB = null;
    }

    private prepare(): void {
        if (!this.dialogView) this.dialogView = new DialogView(this.node, this.text, this.confirmBtn, this.cancelBtn);
    }

    protected close(): void {
        if (this.closeCB) this.closeCB();
        this.node.active = false;
    }

    public show(text: string, type: number): void {
        this.prepare();
        this.dialogView.show(text, type !== DialogType.OnlyCancel, type === DialogType.Default || type === DialogType.OnlyCancel);
    }

    public setClose(cb :Function){
        this.closeCB = cb;
    }

    public setConfirmCB(cb :Function) {
        this.confirmCB = cb;
    }

    public setCancelCB(cb :Function) {
        this.cancelCB = cb;
    }

    protected clickConfirm(){
        AudioManager.instance.playClick();
        if(this.confirmCB){
            this.confirmCB();
        }

        this.close();
    }

    protected clickCancel(){
        AudioManager.instance.playClick();
        if(this.cancelCB){
            this.cancelCB();
        }
        this.close();
    }

}
