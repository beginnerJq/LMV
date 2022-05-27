import { ToolInterface } from "../../src/tools/ToolInterface";

const GlobalManagerMixin = Autodesk.Viewing.GlobalManagerMixin;

export class ExplodeTool extends ToolInterface {
    constructor(viewer) {
        super();

        this.names = ['explode'];
        this.viewer = viewer;
        this.setGlobalManager(this.viewer.globalManager);
        this.active = false;

        this.activate = () => {
            this.active = true;
        };

        this.deactivate = (reset = true) => {
            if (reset)
              this.setScale(0);
            this.active = false;
        };

        this.isActive = () => {
            return this.active;
        };
    }
    
    setScale(value) {
        return this.viewer.explode(value);
    }

    getScale() {
      return this.viewer.getExplodeScale();
  }
}

GlobalManagerMixin.call(ExplodeTool.prototype);
