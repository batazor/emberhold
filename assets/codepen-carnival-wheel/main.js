import * as THREE from "https://esm.sh/three@0.174.0";
import { OrbitControls } from "https://esm.sh/three@0.174.0/addons/controls/OrbitControls.js";
import { GLTFLoader } from "https://esm.sh/three@0.174.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://esm.sh/three@0.174.0/examples/jsm/loaders/DRACOLoader";
import { RGBELoader } from "https://esm.sh/three@0.174.0/examples/jsm/loaders/RGBELoader";
import Lottie from "https://esm.sh/lottie-web";

window.start3 = false;
let cameraSetup = {
  cameraIsSettled: false,
  cameraTgt: {
    x: 0.11611507465368477,
    y: 3.5939784540499456e-16,
    z: 5.8682635668005005
  },
  totalIterations: 900,
  iteration: 0,
  leverTgt: 1
};
let init = () => {
  window.addEventListener("touchstart", isDown);
  window.addEventListener("mousedown", isDown);
  window.addEventListener("mouseup", isUp);
  window.addEventListener("touchend", isUp);
  window.addEventListener("mousemove", isMove);
  window.addEventListener("touchmove", isMove);
  initLottie();
};
let anim = null;
let initLottie = () => {
  anim = Lottie.loadAnimation({
    container: document.getElementById("lottie"),
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "./assets/crnvlintro.json"
  });
  let loop = () => {
    anim.goToAndPlay(120, true);
  };
  anim.addEventListener("loopComplete", loop);
};
let wheel;
let lever = null;
let hitArea = null;
let pullSign = null;
let ready = false;
let speed = 0;
let inc = 0.02;
let mouse = {
  direction: null,
  pressing: false,
  curY: null,
  isClicking: false,
  dragStarted: false,
  dragDistance: 0,
  isSpinning: false
};
let revealAnim = {
  isAnimating: false,
  isShowing: false
};
let signSpinSpeed = 1;
let incSpeed = 12;
let resultSign = null;
let resultAnim = null;
let animAction = null;
let animMixer = null;
let numArr = [];
//
let deviceType = null;
//
const canvas = document.querySelector("canvas.webgl");
//
const scene = new THREE.Scene();
//
const textureLoader = new THREE.TextureLoader();
//
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("draco/");
//
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
//
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
//
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
if (isMobile) {
  deviceType = "mobile";
} else {
  deviceType = "desktop";
}
const isDown = (e) => {
  mouse.pressing = true;
  let tgt = "";
  if (deviceType == "mobile") {
    tgt = e.targetTouches[0];
  } else {
    tgt = e;
  }
  mouse.x = tgt.clientX;
  mouse.y = tgt.clientY;
  //
  pointer.x = (tgt.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(tgt.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  // calculate objects intersecting the picking ray
  const intersects = raycaster.intersectObject(hitArea);
  if (intersects.length > 0) {
    //    console.log("clicking");
    //clicking the lever
    e.preventDefault();
    controls.enableRotate = false;
    mouse.isClicking = true;
  }
};
const isUp = (e) => {
  mouse.pressing = false;
  mouse.isClicking = false;
  mouse.direction = null;
  controls.enableRotate = true;
  if (mouse.dragStarted) {
    mouse.dragStarted = false;
    lever.rotation.x = 1;
  }
};
//
const isMove = (e) => {
  // console.log("isMove");
  let tgt = "";
  if (deviceType == "mobile") {
    tgt = e.targetTouches[0];
  } else {
    tgt = e;
  }
  mouse.x = tgt.clientX;
  mouse.y = tgt.clientY;

  // console.log(mouse.y);
  if (mouse.pressing && mouse.isClicking) {
    e.preventDefault();
    controls.enableRotate = false;

    if (mouse.curY == null) {
      //first click
    } else if (mouse.curY > tgt.clientY) {
      // console.log("moving up");
      mouse.direction = "up";
    } else if (mouse.curY < tgt.clientY) {
      // console.log("moving down");
      if (mouse.direction != "down") {
        mouse.direction = "down";
        mouse.dragDistance = 0;
      } else {
        //already moving down, lets move the lever
        let dist = tgt.clientY - mouse.curY;
        mouse.dragStarted = true;
        mouse.dragDistance += dist;
        let r = Math.min(2, mouse.dragDistance / 100 + 1);
        lever.rotation.x = r;
        if (inc < 0.4) {
          inc += r / 100;
        }
      }
    }
    mouse.curY = tgt.clientY;
  } else {
    mouse.mouseDirection = null;
    mouse.curY = null;
    return;
  }
};
//
const sizes = { width: window.innerWidth, height: window.innerHeight };

window.addEventListener("resize", () => {
  // Update sizes
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  // Update camera
  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  // Update renderer
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

const camera = new THREE.PerspectiveCamera(
  35,
  sizes.width / sizes.height,
  0.1,
  100
);
camera.position.set(10, -2.3, -15.4);
scene.add(camera);

// Controls
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 4;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI / 2;
controls.maxAzimuthAngle = 0.785;
controls.minAzimuthAngle = -1.5;
//
const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: true
});
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

//
const bakedTexture = textureLoader.load(
  "./assets/baked.jpg"
);
bakedTexture.flipY = false;
bakedTexture.colorSpace = THREE.SRGBColorSpace;

// const wheelTexture = textureLoader.load('wheelv1.png')
const wheelTexture = textureLoader.load(
  "./assets/wheel.jpg"
);
wheelTexture.flipY = false;
wheelTexture.colorSpace = THREE.SRGBColorSpace;
//
const shadowTexture = textureLoader.load(
  "./assets/shadow.png"
);
shadowTexture.flipY = false;
shadowTexture.colorSpace = THREE.SRGBColorSpace;
//
const bakedMaterial = new THREE.MeshBasicMaterial({ map: bakedTexture });
const wheelMaterial = new THREE.MeshBasicMaterial({ map: wheelTexture });
// const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent:true, opacity:0.5 })
const shadowMaterial = new THREE.MeshBasicMaterial({
  map: shadowTexture,
  transparent: true,
  opacity: 0.5
});
const transpMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(0x000000),
  transparent: true,
  opacity: 0
});
//
gltfLoader.load("./assets/carnival.glb", (gltf) => {
  // console.log(gltf);
  gltf.scene.traverse((child) => {
    // console.log(child.name);
    if (child.name == "lever") {
      lever = child;
      lever.rotation.x = 2;
      child.material = bakedMaterial;
    } else if (child.name == "hitarea") {
      hitArea = child;
      child.material = transpMaterial;
    } else if (child.name == "wheel") {
      child.material = wheelMaterial;
      wheel = child;
      // window.wheel=wheel
      ready = true;
    } else if (child.name == "shadow") {
      child.material = shadowMaterial;
      // child.visible = false;
    } else if (child.name == "sign_swing") {
      //pull sign at intro
      child.material = bakedMaterial;
      pullSign = child;
    } else if (child.name == "result_panel") {
      // result animation
      child.material = bakedMaterial;
      initResultAnimation(child, gltf);
    } else if (child.name.includes("num")) {
      numArr.push(child);
      child.material = bakedMaterial;
      child.visible = false;
    } else {
      child.material = bakedMaterial;
    }
  });
  scene.add(gltf.scene);
  // console.log(numArr);
});
let initResultAnimation = (child, gltf) => {
  resultSign = child;
  resultAnim = THREE.AnimationClip.findByName(
    gltf.animations,
    "result_panelAction"
  );
  // resultAnim = gltf.animations[0]
  animMixer = new THREE.AnimationMixer(resultSign);
  // animMixer.addEventListener( 'loop', (e) => { console.log("loopDone")})

  animMixer.addEventListener("finished", (e) => {
    manageRevealAnim(e);
  });
  animAction = animMixer.clipAction(resultAnim);
  animAction.reset();
  animAction.clampWhenFinished = true;
  animAction.timeScale = 1;
  animAction.setLoop(THREE.LoopOnce, 1);
  // animAction.play();
};
let manageRevealAnim = (e) => {
  // console.log("finished");
  if (revealAnim.isShowing == true) {
    //         //its now closed
    if (!mouse.isSpinning) {
      revealAnim.isShowing = false;
    }
  } else {
    //         //its now open
    if (!mouse.isSpinning) {
      revealAnim.isShowing = true;
    }
  }
  revealAnim.isAnimating = false;
  animAction.paused = true;
  // console.log(revealAnim.isShowing);
};
//

const clock = new THREE.Clock();
//
let showNumber = (answer) => {
  let itm = numArr[answer - 1];
  numArr.forEach((n) => {
    n.visible = false;
  });
  itm.visible = true;
  // console.log(answer, numArr[answer-1]);
};
let easeOutCubic = (t, b, c, d) => {
  t /= d;
  t--;
  return c * (t * t * t + 1) + b;
};
let easeInOutCubic = (t, b, c, d) => {
  t /= d / 2;
  if (t < 1) return (c / 2) * t * t * t + b;
  t -= 2;
  return (c / 2) * (t * t * t + 2) + b;
};

const tick = () => {
  // const elapsedTime = clock.getElapsedTime()

  // Update controls
  controls.update();
  //
  //    console.log(camera.position);
  if (ready) {
    //    console.log((wheel.rotation.z)*(180/Math.PI) ) %360;;
    // wheel.rotation.z  = 0
    if (window.start3) {
      speed += inc;
      if (inc > 0) {
        if (!mouse.isSpinning) {
          inc += 0.1;
        }
        wheel.rotation.z = speed;
        inc -= 0.001;
        mouse.isSpinning = true;
        // animAction.reset();
        if (revealAnim.isShowing) {
          // console.log("should be closing");
          animAction.paused = false;
          revealAnim.isAnimating = true;
          animAction.setLoop(THREE.LoopOnce);
          animAction.timeScale = -1;
          animAction.time = 0.5;
          animAction.play();
          revealAnim.isShowing = false;
        } else {
          //
        }
      } else {
        let rad = (wheel.rotation.z * (180 / Math.PI)) % 360;
        let answer = Math.floor(1 + rad / 36); // +1 for zero offset, /36 because there are 10 sections so 360/36 = 10
        if (mouse.isSpinning == true) {
          showNumber(answer);
          mouse.isSpinning = false;
          // console.log("should be opening");
          animAction.paused = false;
          revealAnim.isAnimating = true;
          animAction.setLoop(THREE.LoopOnce);
          animAction.timeScale = 1;
          animAction.play();
        }
      }
      if (incSpeed > 0) {
        if (pullSign != null) {
          pullSign.rotation.z = Math.sin(signSpinSpeed) / 3;
          signSpinSpeed += incSpeed / 100;
          incSpeed -= 0.068;
        }
      }
      if (!cameraSetup.cameraIsSettled) {
        // console.log("moving cam", cameraSetup.iteration, cameraSetup.totalIterations);
        cameraSetup.iteration++;

        if (cameraSetup.iteration < 100) {
          let xx = easeOutCubic(
            cameraSetup.iteration,
            camera.position.x,
            cameraSetup.cameraTgt.x - camera.position.x,
            cameraSetup.totalIterations
          );
          let yy = easeOutCubic(
            cameraSetup.iteration,
            camera.position.y,
            cameraSetup.cameraTgt.y - camera.position.y,
            cameraSetup.totalIterations
          );
          let zz = easeOutCubic(
            cameraSetup.iteration,
            camera.position.z,
            cameraSetup.cameraTgt.z - camera.position.z,
            cameraSetup.totalIterations
          );
          camera.position.set(xx, yy, zz);
          let leverR = easeInOutCubic(
            cameraSetup.iteration,
            lever.rotation.x,
            cameraSetup.leverTgt - lever.rotation.x,
            80
          );
          lever.rotation.x = leverR;
          // console.log(cameraSetup.cameraTgt.y-camera.position.y);
          // if((Math.abs(cameraSetup.cameraTgt.y)-Math.abs(camera.position.y))<0.0000001){
          // cameraSetup.cameraIsSettled=true;
          // console.log(cameraSetup.iteration);
          // }
        } else {
          cameraSetup.cameraIsSettled = true;
        }
      }
    }
  }
  //reveal animation
  const delta = clock.getDelta();
  if (animMixer) animMixer.update(delta);
  //  console.log(delta);
  // Render
  renderer.render(scene, camera);
  window.requestAnimationFrame(tick);
};
init();
tick();
window.camera = camera;
window.controls = controls;
window.anim = anim;