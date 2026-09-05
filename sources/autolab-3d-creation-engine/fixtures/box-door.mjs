import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from "three";

// A 4 x 3 x 2 box, with a 1 x 2 doorway on the +z wall and a real mesh cut.
export function buildVehicle() {
  const root = new Group(), order = [], parts = {};
  function part(name, parent = root) {
    const group = new Group(); group.name = name; parent.add(group);
    const p = { name, label: name, category: "shell", group, meshes: [] };
    parts[name] = p; order.push(p); return p;
  }
  function slab(p, size, pos) {
    const mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial());
    mesh.position.set(...pos); p.group.add(mesh); p.meshes.push(mesh); return mesh;
  }
  const body = part("body");
  slab(body, [1.45,3,0.05], [-1.275,1.5,1]);
  slab(body, [1.45,3,0.05], [1.275,1.5,1]);
  slab(body, [1.1,0.95,0.05], [0,2.525,1]);
  slab(body, [4,3,0.05], [0,1.5,-1]);
  slab(body, [0.05,3,2], [-2,1.5,0]); slab(body, [0.05,3,2], [2,1.5,0]);
  slab(body, [4,0.05,2], [0,-0.05,0]); slab(body, [4,0.05,2], [0,3.05,0]);
  const door = part("doorFR"); door.group.position.set(0.5,0,1.025);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute([-1,0,0, 0,0,0, 0,2,0, -1,0,0, 0,2,0, -1,2,0],3));
  const skin = new Mesh(geometry,new MeshBasicMaterial()); door.group.add(skin); door.meshes.push(skin);
  // Separate registered part, parented to the moving door: must also be excluded.
  const handle = part("handle",door.group); slab(handle,[0.15,0.04,0.03],[-0.8,1,0.01]);
  return { root, order, parts, openT:0, explodeT:0, panelsT:1,
    update() { door.group.rotation.y = this.openT; },
    addBar(name = "bar", z = 0.98) { const p = part(name); slab(p,[2,0.04,0.02],[0,1,z]); return p; },
  };
}
