var addLineNumbers = function(code) {
    var lines = code.split('\n');
    for (var i = 0; i < lines.length; i++) {
        lines[i] = (i + 1) + ': ' + lines[i];
    }
    return lines.join('\n');
};

export function WebGLShader(gl, type, code) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (typeof DEBUG_SHADERS !== "undefined" && DEBUG_SHADERS) {
        if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === false) {
            console.error('THREE.WebGLShader: Shader couldn\'t compile.');
        }

        if (gl.getShaderInfoLog(shader) !== '') {
            console.warn('THREE.WebGLShader: gl.getShaderInfoLog()', gl.getShaderInfoLog(shader), addLineNumbers(code));
        }
    }
    return shader;
}

