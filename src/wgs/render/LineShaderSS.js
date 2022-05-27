import * as THREE from "three";
import liness_vert from './shaders/liness_vert.glsl';
import liness_frag from './shaders/liness_frag.glsl';
import { LineShader } from "./LineShader";

//A variant of the LineShader that renders screen aligned lines at all times
//even for lines that are oriented in planes at oblique angles to the screen
//e.g. when a line is renderd in a 3d model with perspective camera.

export let LineShaderSS = {

  uniforms: THREE.UniformsUtils.merge([
    LineShader.uniforms,
    {
      "aaRange": { type: "f", value: 1.0 }, //aaRange = 0.5/pixelsPerUnit
      "size": { type: "v2", value: new THREE.Vector2(1024, 768) }, //the screen (or render target) size
      "cameraPos": { type: "v3", value: new THREE.Vector3() },
      "tanHalfFov": { type: "f", value: 0.0 }, // tan(camera.fov / 2)
    }
  ]),

  vertexShader: liness_vert,
  fragmentShader: liness_frag
};
