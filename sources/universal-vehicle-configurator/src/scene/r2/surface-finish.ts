/** Object-space finishes work on the procedural lofts, which have no UV maps. */
export function surfaceFinish(role: string) {
  if (!["paint", "trim", "cladding", "tyre", "disc", "cabin"].includes(role)) return null;
  const library = /* glsl */ `
    varying vec3 vFinishPosition;
    float r2Hash(vec3 p) {
      p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }
    float r2Noise(vec3 p) {
      vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(r2Hash(i),r2Hash(i+vec3(1,0,0)),f.x),
                     mix(r2Hash(i+vec3(0,1,0)),r2Hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(r2Hash(i+vec3(0,0,1)),r2Hash(i+vec3(1,0,1)),f.x),
                     mix(r2Hash(i+vec3(0,1,1)),r2Hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    vec3 r2Bump(vec3 p, vec3 n, float h, float facing) {
      vec3 dx = dFdx(p), dy = dFdy(p);
      vec3 r1 = cross(dy,n), r2 = cross(n,dx);
      float det = dot(dx,r1) * facing;
      vec3 grad = sign(det) * (dFdx(h)*r1 + dFdy(h)*r2);
      return normalize(max(abs(det),1e-10)*n-grad);
    }
  `;
  let body: string;
  if (role === "paint") body = /* glsl */ `
    float grain = r2Noise(vFinishPosition * 1600.0);
    float visibility = 1.0-smoothstep(0.4,1.6,length(fwidth(vFinishPosition*1600.0)));
    roughnessFactor = clamp(roughnessFactor + (grain-0.5)*0.09*visibility,0.08,1.0);
    float peel = r2Noise(vFinishPosition*260.0);
    float peelVisibility = 1.0-smoothstep(0.7,2.0,length(fwidth(vFinishPosition*260.0)));
    float finishHeight = peel * 0.000014 * peelVisibility;
  `;
  else if (role === "tyre") body = /* glsl */ `
    float radius = length(vFinishPosition.xz);
    float tread = smoothstep(0.382,0.402,radius);
    float axial = vFinishPosition.y;
    float grooveDistance = abs(fract(axial/0.051+0.5)-0.5)*0.051;
    float aa = max(fwidth(axial),0.0004);
    float channels = 1.0-smoothstep(0.002,0.0035+aa,grooveDistance);
    float angle = atan(vFinishPosition.z,vFinishPosition.x);
    float block = abs(fract(angle*9.55+axial*14.0)-0.5);
    float sipes = 1.0-smoothstep(0.028,0.048+fwidth(block),block);
    float grooves = max(channels,sipes*0.8)*tread;
    diffuseColor.rgb *= 1.0-grooves*0.45;
    roughnessFactor = mix(0.78,0.96,tread);
    float finishHeight = -grooves*0.0012 + r2Noise(vFinishPosition*420.0)*0.000025;
  `;
  else if (role === "disc") body = /* glsl */ `
    float radial = length(vFinishPosition.xz)*18000.0;
    float visibility = 1.0-smoothstep(0.8,3.0,fwidth(radial));
    float machining = sin(radial)*visibility;
    roughnessFactor += machining*0.08;
    float finishHeight = machining*0.000002;
  `;
  else body = /* glsl */ `
    float grain = r2Noise(vFinishPosition*${role === "cabin" ? "900.0" : "520.0"});
    float visibility = 1.0-smoothstep(0.5,2.0,length(fwidth(vFinishPosition*520.0)));
    roughnessFactor = clamp(roughnessFactor+(grain-0.5)*0.12*visibility,0.1,1.0);
    float finishHeight = grain*${role === "cabin" ? "0.00010" : "0.00007"}*visibility;
  `;
  return { library, body };
}
