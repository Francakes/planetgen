import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { generateGeologicalData, determinePlanetaryComposition } from './generators/crust.js';
import { generateOrbit, generateParentStar, generateStarSizeAndMass, generateStarLuminosity, calculateHabitableZone, determinePlanetType  } from './generators/orbit.js';
import { getPlanetAtmosphere, getAtmosphereDetailsForDisplay, calculateSurfaceTemperature } from './generators/atmosphere.js';

import { elementsData } from './generators/crust.js';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BloomPass } from 'three/addons/postprocessing/BloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { musgraveFragmentShader, musgraveVertexShader } from './generators/texture.js';
import { createNoise2D, createNoise3D, createNoise4D }  from './node_modules/simplex-noise/dist/esm/simplex-noise.js';

// Global variables for the three.js objects
let sphere, scene, camera, renderer, controls, canvas;
let starLight, ambientLight;
let composer;
let bloomPass;
let celestialObjects = [];
let currentTargetIndex = 0; // Initialize the index for the currently targeted object globally
let desiredTargetPosition = new THREE.Vector3();
let followOffset = new THREE.Vector3();
let isZooming = false;
let zoomTargetPosition = new THREE.Vector3();
let zoomTargetLookAt = new THREE.Vector3();
let bloomStrength = 0.3;
let bloomRadius = 0.9;
let bloomThreshold = 0.75;
const AU_TO_SCENE_SCALE = 21840.00;

let universeData = {
    parentStar: {
        type: null,
        size: null,
        age: null,
        mass: null,
        luminosity: null,
        habitableZone: {
            innerBoundary: null,
            outerBoundary: null
        }
    },
    solarSystem: [],
    selectedPlanet: null,
    systemOuterEdge: null,
};

function exportUniverseData() {
    const dataString = JSON.stringify(universeData);
    const base64Data = btoa(dataString);
    console.log('Exported Data:', base64Data);
    navigator.clipboard.writeText(base64Data).then(() => {
        alert('System data exported and copied to clipboard.');
    });
}

function importUniverseData(base64Data) {
    try {
        const dataString = atob(base64Data); 
        const dataObject = JSON.parse(dataString);
        universeData = dataObject; 
        console.log('Imported Data:', universeData);
        updateScene(); 
    } catch (error) {
        console.error('Failed to import data:', error);
        alert('Invalid data format. Please ensure you are using a valid exported string.');
    }
}

function populateUniverseData() {
    const orbitData = generateOrbit();

    universeData.parentStar = orbitData.parentStar;
    universeData.starData = orbitData.parentStar;

    // Calculate systemOuterEdge before mapping over solarSystem
    // Ensure orbitData.solarSystem is sorted or has the last planet as the furthest one
    let systemOuterEdge = orbitData.solarSystem[orbitData.solarSystem.length - 1].orbitRadius;

    universeData.solarSystem = orbitData.solarSystem.map(planet => {
        const baseSpeed = 0.00001; // Base speed for scaling
        const scalingFactor = 21840; // Adjust this factor to control the scaling effect
        const orbitalSpeed = baseSpeed / (planet.orbitRadius * scalingFactor);
        let rotationSpeed = getRotationSpeed(planet.orbitRadius, { innerBoundary: universeData.parentStar.habitableZone.innerBoundary, outerBoundary: universeData.parentStar.habitableZone.outerBoundary }, AU_TO_SCENE_SCALE, systemOuterEdge);
        const geologicalData = generateGeologicalData(planet.radius, planet.orbitRadius, universeData.parentStar.size, universeData.parentStar.mass);
        const atmosphereComposition = getPlanetAtmosphere(planet.type, planet.orbitRadius, universeData.parentStar.habitableZone);
        const surfaceTemperature = calculateSurfaceTemperature(universeData.parentStar.luminosity, calculateStarTemperature(universeData.parentStar.type), planet.orbitRadius, planet.size, atmosphereComposition // Ensure this matches expected input in calculateSurfaceTemperature
        );
        return {
            type: planet.type,
            radius: planet.size,
            orbitRadius: planet.orbitRadius,
            atmosphere: planet.atmosphere,
            moons: planet.moons,
            axialTilt: planet.axialTilt,
            rotationSpeed,
            orbitalSpeed,
            isTidallyLocked: Math.random() < 0.1,
            geologicalData,
            atmosphereComposition,
            surfaceTemperature,
        };
    });

    // Now that systemOuterEdge is calculated outside the map, it can be assigned to universeData
    universeData.systemOuterEdge = systemOuterEdge;
}

function filterVitalDataForExport(universeData) {
    const filteredData = {
        parentStar: {
            type: universeData.parentStar.type,
            size: universeData.parentStar.size,
            mass: universeData.parentStar.mass,
            luminosity: universeData.parentStar.luminosity
        },
        solarSystem: universeData.solarSystem.map(planet => ({
            type: planet.type,
            orbitRadius: planet.orbitRadius,
            size: planet.radius, // Assuming 'radius' is the size property
            axialTilt: planet.axialTilt,
            moons: planet.moons,
            isTidallyLocked: planet.isTidallyLocked
        }))
    };
    return filteredData;
}

document.addEventListener('DOMContentLoaded', () => {
    
    // Initialize default star and planet data directly into universeData
    universeData.parentStar = {
        type: 'G',
        size: 1,
        luminosity: 1,
        habitableZone: { innerBoundary: 0.95, outerBoundary: 1.37 }
    };
    universeData.solarSystem = [
        { type: 'Terrestrial', radius: 1, orbitRadius: 1 }
    ];
    universeData.selectedPlanet = universeData.solarSystem[0]; // Assuming the first planet as the selected one

    setupThreeJS();
    setupStarGeneration();
    setupSolarSystemGeneration();

    let currentTargetIndex = 0; // Initialize the index for the currently targeted object

    document.getElementById('prevPlanet').addEventListener('click', () => {
        currentTargetIndex = Math.max(currentTargetIndex - 1, 0);
        updateDesiredTargetPosition(currentTargetIndex);
        selectPlanet(currentTargetIndex); // Update the target planet for the camera
        if (currentTargetIndex > 0) {
            // Adjust the index by -1 because the first index (0) is reserved for the star
            displayTimeConversions(currentTargetIndex - 1);
        }
        displayHabitablePlanetDetails(currentTargetIndex - 1);
     //   displayElementalComposition(currentTargetIndex - 1); // Display composition for the newly selected planet
     const currentPlanet = universeData.solarSystem[currentTargetIndex];
     if (currentPlanet) {
        console.log('Geological Data for current planet:', currentPlanet.geologicalData);
    }

    });
    
    document.getElementById('snapToStar').addEventListener('click', () => {
        currentTargetIndex = 0; // Index of the star
        updateDesiredTargetPosition(currentTargetIndex);
        selectPlanet(currentTargetIndex);
        // Optionally, clear the display or skip displaying conversions for the star
        displayHabitablePlanetDetails(currentTargetIndex - 1);
     //   displayElementalComposition(currentTargetIndex - 1); // Display composition for the newly selected planet
    });
    
    document.getElementById('nextPlanet').addEventListener('click', () => {
        currentTargetIndex = Math.min(currentTargetIndex + 1, celestialObjects.length - 1);
        updateDesiredTargetPosition(currentTargetIndex);
        selectPlanet(currentTargetIndex); // Update the target planet for the camera
        if (currentTargetIndex > 0) {
            // Adjust the index by -1 because the first index (0) is reserved for the star
            displayTimeConversions(currentTargetIndex - 1);
            
        }
        displayHabitablePlanetDetails(currentTargetIndex - 1);
      //  displayElementalComposition(currentTargetIndex - 1); // Display composition for the newly selected planet
      const currentPlanet = universeData.solarSystem[currentTargetIndex];
      if (currentPlanet) {
        // console.log('Geological Data for current planet:', currentPlanet.geologicalData);
     }

    });

    document.getElementById('zoomToPlanetButton').addEventListener('click', function() {
        if (currentTargetIndex >= 0 && currentTargetIndex < celestialObjects.length) {
            const targetPlanet = celestialObjects[currentTargetIndex];
            if (targetPlanet) {
                // Calculate the target zoom position
                const distance = targetPlanet.geometry.parameters.radius * 3;
                zoomTargetPosition.set(targetPlanet.position.x, targetPlanet.position.y, targetPlanet.position.z + distance);
                zoomTargetLookAt.copy(targetPlanet.position);
                updateDesiredTargetPosition(currentTargetIndex);

                // Start zooming
                isZooming = true;
            }
        }
    });

    document.getElementById('exportSystem').addEventListener('click', function() {
        // Call the filterVitalDataForExport function to get the filtered data
        const filteredData = filterVitalDataForExport(universeData);
        const dataStr = JSON.stringify(filteredData);
        const base64Str = btoa(unescape(encodeURIComponent(dataStr)));
        document.getElementById('base64Output').value = base64Str;
    });

    document.getElementById('importSystem').addEventListener('click', function() {
        try {
            const inputStr = decodeURIComponent(escape(window.atob(document.getElementById('base64Input').value)));
            universeData = JSON.parse(inputStr);
            alert('System data imported successfully!');
            updateScene();
        } catch (e) {
            alert('Failed to import data. Please ensure the base64 string is correct.');
        }
    });
});

async function updateScene() {
    cleanUp(); // Clears the scene of existing planets and star meshes
    await generatePlanets(); // Await the asynchronous generation of planets and their compositions
    generateRings();
    updateStarLight();
    addStarToScene();
    // updateShaderLighting();
    generateMoons();
    generateSystemName();
    visualizeOrbits();
    generateAtmospheres();
    zoomToStar();
}

function zoomToStar(starSize){
currentTargetIndex = 0; // Index of the star
updateDesiredTargetPosition(currentTargetIndex);
selectPlanet(currentTargetIndex);
// Optionally, clear the display or skip displaying conversions for the star
displayHabitablePlanetDetails(currentTargetIndex - 1);
const cameraDistance = starSize * 2.5;
camera.position.set(0, 0, 1250); // You might want to experiment with these values

}

function setupThreeJS() {
    initializeThreeJSEnvironment('planetCanvas');
    setupOrbitControls();
    const axesHelper = new THREE.AxesHelper(5); // The parameter defines the size of the axes in units.
    scene.add(axesHelper);
    setupLighting(); // Now uses universeData
    startAnimationLoop();
}

function initializeThreeJSEnvironment(canvasId) {
    canvas = document.getElementById(canvasId);
    scene = new THREE.Scene();

    const starFieldTexture = createStarFieldTexture(); 
    scene.background = starFieldTexture;

    camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.01, 1000000);
    camera.position.set(0, 0, 500); 
    camera.castShadow = true;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; 

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), 

        bloomStrength,
        bloomRadius,
        bloomThreshold,
    );
    composer.addPass(bloomPass);
    
    const effectCopy = new ShaderPass(CopyShader);
    effectCopy.renderToScreen = true;
    composer.addPass(effectCopy);

    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    //	console.log("Window resized: New dimensions", canvas.clientWidth, "x", canvas.clientHeight);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
	//    console.log("Camera aspect updated to:", camera.aspect);
}

function updateDesiredTargetPosition(index) {
    const targetObject = celestialObjects[index];
    if (targetObject) {
        desiredTargetPosition.copy(targetObject.position);
        
    }
}

function createPlanet(planetData, index) {
    // const habitableZone = universeData.parentStar.habitableZone;
    const planetGeometry = new THREE.SphereGeometry(planetData.radius, 32, 32);
    const starSize = universeData.parentStar.size;
    const starMass = universeData.parentStar.mass;
    const geologicalData = generateGeologicalData(planetData.radius, planetData.orbitRadius, starSize, starMass);

    const noiseTexture = createNoiseTexture();
    // let musgraveTexture = generateFBMNoiseTexture(1024, 1024, 0.01, 0.5, 8, 2.0);
    // let planetTexture;
    let normalMap = null;
    let roughnessAmount = 0;
    // let cloudTexture = new THREE.TextureLoader().load('./texture/water_clouds_d.png');
    // let isTransparent = false;
    // let cloudOpacity = 0.0;
    let planetEmissiveTexture = null;
    let emissiveColor = 0x000000;
    let emissiveIntensityValue = 0;
    let normalMapIntensity =  new THREE.Vector2(0.0, 0.0);
    let material;

    if (planetData.type === 'Terrestrial') {
        material = new THREE.MeshStandardMaterial({
            map: new THREE.TextureLoader().load('./texture/terr_d.png'),
            roughness: 0.6,
           // color: getColorForPlanetType(planetData.type),
    
        })
        planetGeometry.rotateZ(Math.PI / 2); //rotate so texture applies properly

      }


else if (planetData.type === 'Lava Planet') {
    material = new THREE.MeshStandardMaterial({
        map: new THREE.TextureLoader().load('./texture/lava_d.png'),
        emissiveMap: new THREE.TextureLoader().load('./texture/lava_e.png'),
        emissive: 0xffffff,
        emissiveIntensity: 1.25,
        roughness: 0.8,
        normalMap: new THREE.TextureLoader().load('./texture/lava_n.png'),


    })
    planetGeometry.rotateZ(Math.PI / 2); //rotate so texture applies properly

}
else if (planetData.type === 'Gas Giant' || planetData.type === 'Ice Giant') {
    material = new THREE.MeshStandardMaterial({
        map: new THREE.TextureLoader().load('./texture/giant_d_2.png'),
        roughness: 0.95,
        normalMap: new THREE.TextureLoader().load('./texture/giant_n.png'),


    })
    planetGeometry.rotateZ(Math.PI / 2); //rotate so texture applies properly

}
else if (planetData.type === 'Ocean World') {
    material = new THREE.MeshStandardMaterial({
        map: new THREE.TextureLoader().load('./texture/ocean_d.png'),
        roughness: 0.6,
        color: getColorForPlanetType(planetData.type),

    })
    planetGeometry.rotateZ(Math.PI / 2); //rotate so texture applies properly

}
else {
    material = new THREE.MeshStandardMaterial({
        map: noiseTexture,
        color: getColorForPlanetType(planetData.type),
        normalMap: normalMap,
        normalScale: normalMapIntensity,
        roughness: roughnessAmount,
        emissiveMap: planetEmissiveTexture,
        emissive: emissiveColor,
        emissiveIntensity: emissiveIntensityValue,
    });
    planetGeometry.rotateZ(Math.PI / 2); //rotate so texture applies properly

}

    const planetMesh = new THREE.Mesh(planetGeometry, material);
    const phi = Math.PI / 2; // Horizontal plane
    const theta = Math.random() * Math.PI * 2; // Randomize starting position on orbit
    planetMesh.position.setFromSphericalCoords(
        planetData.orbitRadius * AU_TO_SCENE_SCALE, 
        phi, // Horizontal plane
        theta // Randomized azimuthal angle
    );

    const axialTiltRadians = THREE.Math.degToRad(planetData.axialTilt);
    planetMesh.rotation.x = axialTiltRadians; // Tilting the planet around its X-axis
    planetMesh.name = `planet${index}`;

 if (planetData.type === 'Ocean World' || planetData.type === 'Terrestrial') {
    const cloudGeometry = new THREE.SphereGeometry(planetData.radius * 1.01, 32, 32);
    const cloudMaterial = new THREE.MeshPhongMaterial({
        map: new THREE.TextureLoader().load('./texture/water_clouds_d.png'),
        alphaMap: new THREE.TextureLoader().load('./texture/water_clouds_d.png'),
        transparent: true,
        depthWrite: false,
        opacity: 0.6,
    });
    cloudMaterial.blending = THREE.AdditiveBlending; 
    const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
    cloudGeometry.rotateZ(Math.PI / 2);
    cloudGeometry.rotateX = axialTiltRadians; 
    planetData.cloudMesh = cloudMesh;
    planetMesh.add(cloudMesh);

}
    scene.add(planetMesh);
    celestialObjects[index + 1] = planetMesh; //index + 1 because index 0 is reserved for the star
    planetData.geologicalData = geologicalData;

}

function addRingsToPlanet(planetMesh, planetData, index) {
    if (planetData.type === 'Gas Giant' || planetData.type === 'Ice Giant') {
        const { group: ringGroup, outerRadius } = createSegmentedRings(planetData.radius, planetData.type, planetData.axialTilt);
        const axialTiltRadians = THREE.Math.degToRad(planetData.axialTilt);
        ringGroup.rotation.y = axialTiltRadians;

        planetMesh.add(ringGroup);
        // adjustShadowCameraForRings(planetData.radius, outerRadius);
        planetData.ringAxialTilt = planetData.axialTilt;

    }
}

async function generatePlanets() {
    for (let i = 0; i < universeData.solarSystem.length; i++) {
        const planetData = universeData.solarSystem[i];
        createPlanet(planetData, i);
        const composition = await determinePlanetaryComposition(planetData.radius, planetData.orbitRadius, universeData.parentStar.size, universeData.parentStar.mass);
        planetData.composition = composition;
    }
}

function generateAtmospheres() {
    universeData.solarSystem.forEach((planetData, index) => {
        const planetMesh = scene.getObjectByName(`planet${index}`);
        if (planetMesh) {
            const atmosphereComposition = getPlanetAtmosphere(planetData.type, planetData.orbitRadius, universeData.parentStar.habitableZone);
            const atmosphereMesh = createAtmosphere(planetData.radius, atmosphereComposition);
            atmosphereMesh.name = `atmosphere${index}`;
            planetMesh.add(atmosphereMesh);
        }
    });
}

function generateRings() {
    universeData.solarSystem.forEach((planetData, index) => {
        const planetMesh = scene.getObjectByName(`planet${index}`);
        if (planetMesh && (planetData.type === 'Gas Giant' || planetData.type === 'Ice Giant')) {
            addRingsToPlanet(planetMesh, planetData, index);
        }
    });
}

function updateSurfaceTemperatures() {
    universeData.solarSystem.forEach((planet) => {
        // Ensure all necessary data is present
        if (planet.orbitRadius && planet.atmosphere && universeData.parentStar.luminosity) {
            const surfaceTemperature = calculateSurfaceTemperature(
                universeData.parentStar.luminosity,
                planet.orbitRadius,
                planet.atmosphere,
                universeData.parentStar.temperature,
                planet.size,
            );

            planet.surfaceTemperature = surfaceTemperature;
        }
    });
}

function setupLighting() {
    const starData = universeData.parentStar;
    let { color, intensity } = calculateStarColorAndIntensity(starData.type, starData.luminosity);

    const minIntensity = 0.5;
    const effectiveIntensity = Math.max(intensity, minIntensity);
    color = new THREE.Color(color);
    color = desaturateColor(color.getStyle(), 0.6); 

    if (starLight) {
        scene.remove(starLight);
    }

    starLight = new THREE.PointLight(color, effectiveIntensity);
    starLight.position.set(0, 0, 0); 
    starLight.castShadow = true;

    starLight.shadow.mapSize.width = 2048; 
    starLight.shadow.mapSize.height = 2048;
    starLight.shadow.camera.near = 0.1; 
    starLight.shadow.camera.far = 10000;
    starLight.shadow.radius = 4;

    scene.add(starLight);
    adjustLightPosition();

    if (ambientLight) {
        ambientLight.color.set(color);
        ambientLight.intensity = intensity / 10;
    } else {
        ambientLight = new THREE.AmbientLight(color, intensity / 10);
        scene.add(ambientLight);
    }

    addStarToScene();
}

function setupOrbitControls() {
    controls = new OrbitControls(camera, renderer.domElement);
    // controls = new OrbitControlsLocal(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.enableZoom = true;
}

function startAnimationLoop() {
    let followSpeed = 0.05; 

    function animate() {
        requestAnimationFrame(animate);
        animatePlanets();
        animateMoons();
        animateClouds();

        controls.target.lerp(desiredTargetPosition, followSpeed);
        updateDesiredTargetPosition(currentTargetIndex);

       if (isZooming) {
        camera.position.lerp(zoomTargetPosition, 0.05);
        const lookAtPosition = new THREE.Vector3().lerpVectors(camera.position, zoomTargetLookAt, 0.05);
        camera.lookAt(lookAtPosition);

        if (camera.position.distanceTo(zoomTargetPosition) < 0.1) {
            isZooming = false;
            camera.position.copy(zoomTargetPosition);
            camera.lookAt(zoomTargetLookAt);
            }
        }
        controls.update();
        composer.render();
    }


animate()
}

function animatePlanets() {
    universeData.solarSystem.forEach((planetData, index) => {
        const planetMesh = scene.getObjectByName(`planet${index}`);
        if (planetMesh) {
            planetMesh.rotation.y += planetData.rotationSpeed * 20;

            const orbitRadius = planetData.orbitRadius * AU_TO_SCENE_SCALE;
            const theta = (Date.now() * planetData.orbitalSpeed) % (Math.PI * 2);
            planetMesh.position.x = Math.cos(theta) * orbitRadius;
            planetMesh.position.z = Math.sin(theta) * orbitRadius;

            if (planetMesh.material && planetMesh.material.isShaderMaterial && planetMesh.material.uniforms.objectWorldPosition && planetMesh.material.uniforms.rotationMatrix) {
                planetMesh.material.uniforms.objectWorldPosition.value.copy(planetMesh.position);
                planetMesh.material.uniforms.rotationMatrix.value = new THREE.Matrix4().makeRotationFromEuler(planetMesh.rotation);
                planetMesh.material.uniforms.lightColor.value.copy(starLight.color);
                planetMesh.material.uniforms.lightPosition.value.copy(starLight.position);
                planetMesh.material.uniforms.lightIntensity.value = starLight.intensity;

            }

            if (planetData.cloudMesh && planetData.cloudMesh.material && planetData.cloudMesh.material.isShaderMaterial && planetData.cloudMesh.material.uniforms.objectWorldPosition) {
                planetData.cloudMesh.material.uniforms.objectWorldPosition.value.copy(planetMesh.position);
            }
        }
    });
}

function animateClouds() {
    universeData.solarSystem.forEach((planetData, index) => {
        const planetMesh = scene.getObjectByName(`planet${index}`);
        if (planetMesh && planetData.cloudMesh) {
            const cloudMesh = planetData.cloudMesh;
            cloudMesh.rotation.y += -0.002;
        }
    });
}

function animateMoons() {
    universeData.solarSystem.forEach((planetData, index) => {
        const planetMesh = scene.getObjectByName(`planet${index}`);
        if (planetMesh && planetData.moons > 0) {
            planetMesh.children.forEach((moon) => {
                if (moon.name.startsWith('moon')) {
                    const orbitData = moon.userData.orbit;
                    const angle = (Date.now() * orbitData.speed * 4 + orbitData.phase) % (Math.PI * 2);

                    moon.position.set(
                        Math.cos(angle) * orbitData.radius,
                        Math.sin(angle) * Math.sin(orbitData.inclination) * orbitData.radius,
                        Math.sin(angle) * Math.cos(orbitData.inclination) * orbitData.radius
                    );
                }
            });
        }
    });
}

function visualizeOrbits() {
    universeData.solarSystem.forEach((planetData, index) => {
        const orbitRadius = planetData.orbitRadius * AU_TO_SCENE_SCALE;
        const orbitGeometry = new THREE.RingGeometry(orbitRadius - 0.1, orbitRadius, 64);
        const orbitMaterial = new THREE.LineBasicMaterial({ color: 0xDED38D, transparent: true, opacity: 0.05 });
        
        const orbitPath = new THREE.LineLoop(orbitGeometry, orbitMaterial);
        orbitPath.rotation.x = Math.PI / 2; 
        orbitPath.name = `orbitPath${index}`; 
        scene.add(orbitPath);
    });
}

function displayElementalComposition(planetIndex) {
    if (planetIndex < 0 || planetIndex >= universeData.solarSystem.length) return;

    const habitablePlanetDiv = document.getElementById('habitablePlanetDetails');
    const planet = universeData.solarSystem[planetIndex];
    let headerContent = `<div class="element-details-header">Elemental Composition for ${planet.name || `Planet ${planetIndex + 1}`}</div>`;
    let gridContent = '<div class="element-details-container">';

    Object.entries(planet.composition).forEach(([element, mass]) => {
        const elementName = formatElementName(element); 
        gridContent += `<div class="element-detail">${elementName}: ${mass.toExponential(2)} kg</div>`;
    });

    gridContent += "</div>"; 
    habitablePlanetDiv.innerHTML += headerContent + gridContent; 

}

function selectPlanet(index) {
    currentTargetIndex = index;
    if (celestialObjects[currentTargetIndex]) {
        const planet = celestialObjects[currentTargetIndex];
        followOffset.copy(camera.position).sub(planet.position);
    }
}

function updateStarLight() {
    const starData = universeData.parentStar;
    let { color, intensity } = calculateStarColorAndIntensity(starData.type, starData.luminosity);
    color = new THREE.Color(color);
    color = desaturateColor(color.getStyle(), 0.45); 

    const minIntensity = 5; 
    const effectiveIntensity = Math.max(intensity, minIntensity);

     if (starLight) {
        starLight.color.set(new THREE.Color(color));
        starLight.intensity = effectiveIntensity / 2;
    }

    if (ambientLight) {
        ambientLight.color.set(new THREE.Color(color));
        ambientLight.intensity = intensity / 1000;
    } else {
        ambientLight = new THREE.AmbientLight(new THREE.Color(color), intensity / 1000);
        scene.add(ambientLight);
    }

    adjustBloomEffect(starData.luminosity);
}

function adjustBloomEffect() {
    const starLuminosity = universeData.parentStar.luminosity;

    const luminosityFloor = 0.75; // Increase if too dim stars are too bright
    const luminosityCeiling = 1.00; // Decrease if very bright stars are too bright
    const minBloomStrength = 0.75; // Minimum bloom, increase if dim stars are too bright
    const maxBloomStrength = 1.00; // Maximum bloom, decrease if bright stars are too overpowering

    let bloomStrength;
    if (starLuminosity <= luminosityCeiling) {
        const normalizedLuminosity = (starLuminosity - luminosityFloor) / (luminosityCeiling - luminosityFloor);
        bloomStrength = maxBloomStrength - normalizedLuminosity * (maxBloomStrength - minBloomStrength);
    } else {
        bloomStrength = maxBloomStrength / (Math.log(starLuminosity - luminosityCeiling + 5));
    }

    bloomStrength = Math.max(bloomStrength, minBloomStrength);
    bloomPass.strength = bloomStrength;
}

function adjustLightPosition() {
    const defaultPosition = { x: 0, y: 0, z: 0 };
    starLight.position.set(defaultPosition.x, defaultPosition.y, defaultPosition.z);

    const variance = 0.3;
    const randomX = (Math.random() - 0.5) * variance;
    const randomY = Math.random() * (variance / 2);

    starLight.position.x += randomX;
    starLight.position.y += Math.abs(randomY);
}

function cleanUp() {
    scene.children = scene.children.filter(child => {
        if (child.name.startsWith('planet') || child.name.startsWith('orbitPath')) {
            if (child.geometry) child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
            return false; 
        }
        return true; 
    });
    celestialObjects = []; 
}

function generateMoons() {
    universeData.solarSystem.forEach((planetData, index) => {
        const planetMesh = scene.getObjectByName(`planet${index}`);
        if (planetMesh && planetData.moons > 0) {
            createMoonsForPlanet(planetMesh, planetData, index);
        }
    });
}

function setupStarGeneration() {
    const generateStarButton = document.getElementById('generateStarButton');

    generateStarButton.addEventListener('click', () => {
        generateStar(); 
        displayStarProperties();
        setupThreeJS(); 
    });
}

function generateStar() {
    const parentStar = generateParentStar();
    const { size, mass } = generateStarSizeAndMass(parentStar.type, parentStar.age);
    const luminosity = generateStarLuminosity(parentStar.type, size);
    const habitableZone = calculateHabitableZone(luminosity);

    universeData.starData = {
        type: parentStar.type,
        age: parentStar.age,
        size: size,
        mass: mass,
        luminosity: luminosity,
        habitableZone: habitableZone
    };

    console.log("Generated Star:", universeData.starData);
}

function addStarToScene() {
    const starData = universeData.parentStar;
    const solarRadiiInEarthRadii = 109.2; 
    const starRadii = starData.size * solarRadiiInEarthRadii;
    const starGeometry = new THREE.SphereGeometry(starRadii, 32, 32);
    const { color, intensity } = calculateStarColorAndIntensity(starData.type, starData.luminosity);

    const minEmissiveIntensity = 4.00; 
    let emissiveIntensity = Math.max(Math.log1p(intensity), minEmissiveIntensity);
    const starTexture = new THREE.TextureLoader().load('./texture/star_d.png');

    const starMaterial = new THREE.MeshStandardMaterial({
        map: starTexture,
        color: new THREE.Color(color),
        emissiveMap: new THREE.TextureLoader().load('./texture/star_e.png'),
        emissive: new THREE.Color(color),
        emissiveIntensity: emissiveIntensity
    });

    const existingStar = scene.getObjectByName('visualStar');
    if (existingStar) {
        scene.remove(existingStar);
    }

    const starMesh = new THREE.Mesh(starGeometry, starMaterial);
    starMesh.name = 'visualStar'; 
    starMesh.position.set(0, 0, 0); 
    scene.add(starMesh);
    celestialObjects[0] = starMesh;

}

function displayStarProperties() {
    const starPropertiesDiv = document.getElementById('starProperties');

    const { type, age, size, mass, luminosity, habitableZone } = universeData.starData;

    starPropertiesDiv.innerHTML = `
        <p>Type: ${type}</p>
        <p>Age: ${age.toFixed(2)} billion years</p>
        <p>Size: ${size.toFixed(2)} Solar radii</p>
        <p>Mass: ${mass.toFixed(2)} Solar masses</p>
        <p>Luminosity: ${luminosity.toFixed(2)} Solar luminosity</p>
        <p>Habitable Zone: ${habitableZone.innerBoundary.toFixed(2)} - ${habitableZone.outerBoundary.toFixed(2)} AU</p>
    `;
}

function setupSolarSystemGeneration() {
    const generateSystemButton = document.getElementById('generateSystemButton');

    generateSystemButton.addEventListener('click', () => {
        populateUniverseData();
        displayStarProperties(universeData.starData);
        displaySolarSystemProperties();
        updateScene();

    });
}

function formatAtmosphere(atmosphere) {
    return atmosphere.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function displaySolarSystemProperties() {
    const solarSystemPropertiesDiv = document.getElementById('solarSystemProperties');
    let htmlContent = '<h3 class="solar-system-title">Solar System Planets</h3>';

    universeData.solarSystem.forEach((planet, index) => {
        const moonsCount = typeof planet.moons === 'number' ? planet.moons : 'N/A';
        const atmosphereFormatted = planet.atmosphere ? formatAtmosphere(planet.atmosphere) : 'N/A';
        const rotationPeriodHours = rotationSpeedToEarthHours(planet.rotationSpeed).toFixed(2);
        const orbitalPeriodDays = orbitalSpeedToEarthDays(planet.orbitalSpeed, planet.orbitRadius).toFixed(2);
        const localDaysPerOrbitValue = localDaysPerOrbit(planet.rotationSpeed, planet.orbitalSpeed, planet.orbitRadius).toFixed(2);

        const planetDetails = `
            <div class="planet-details-container">
                <strong>Planet ${index + 1}</strong>
                <div class="planet-detail">Type: ${planet.type}</div>
                <div class="planet-detail">Orbit Radius: ${planet.orbitRadius.toFixed(2)} AU</div>
                <div class="planet-detail">Size: ${planet.radius.toFixed(2)}</div>
                <div class="planet-detail">Atmosphere: ${atmosphereFormatted}</div>
                <div class="planet-detail">Moons: ${moonsCount}</div>
                <div class="planet-detail">Sidereal Day: ${rotationPeriodHours} hours</div>
                <div class="planet-detail">Sidereal Year: ${localDaysPerOrbitValue} Sidereal Days (${orbitalPeriodDays} Earth Days)</div>
            </div>
            <hr class="planet-separator">`;
        htmlContent += planetDetails;

        if (planet.orbitRadius >= universeData.parentStar.habitableZone.innerBoundary &&
            planet.orbitRadius <= universeData.parentStar.habitableZone.outerBoundary) {
            htmlContent += `<div class="habitable-zone-notice"><strong>This planet is in the habitable zone!</strong></div>`;
        }
    });

    solarSystemPropertiesDiv.innerHTML = htmlContent;
}

async function displayHabitablePlanetDetails(index) {
    const habitablePlanetDiv = document.getElementById('habitablePlanetDetails');

    if (index < 0) {
        habitablePlanetDiv.innerHTML = "<h3>Star Details</h3><p>Details about the star will be displayed here.</p>";
        return;
    }

    if (index >= universeData.solarSystem.length || !universeData.solarSystem[index]) {
        console.error("Invalid planet index or planet data missing.");
        habitablePlanetDiv.innerHTML = "<h3>Invalid Planet Index</h3><p>The selected index does not correspond to a valid planet.</p>";
        return; 
    }

    const planet = universeData.solarSystem[index];
    const atmosphereFormatted = planet.atmosphere ? formatAtmosphere(planet.atmosphere) : 'N/A';
    const planetName = generatePlanetName(index + 1); 
    const rotationPeriodHours = rotationSpeedToEarthHours(planet.rotationSpeed).toFixed(2);
    const orbitalPeriodDays = orbitalSpeedToEarthDays(planet.orbitalSpeed, planet.orbitRadius).toFixed(2);
    const localDaysPerOrbitValue = localDaysPerOrbit(planet.rotationSpeed, planet.orbitalSpeed, planet.orbitRadius).toFixed(2);
    const isInHabitableZone = planet.orbitRadius >= universeData.parentStar.habitableZone.innerBoundary && planet.orbitRadius <= universeData.parentStar.habitableZone.outerBoundary;
    const habitableZoneStatus = isInHabitableZone ? "Yes" : "No";
    const isAtmosphereHospitable = planet.atmosphere === 'nitrogen_type_III';
    const surfaceTemperature = planet.surfaceTemperature; 
    const isTemperatureHospitable = surfaceTemperature >= -80 && surfaceTemperature <= 80;
    const isHospitable = isInHabitableZone && isAtmosphereHospitable && isTemperatureHospitable;
    const hospitableStatus = isHospitable ? "Yes" : "No";


    let elementDetails = `
    <div class="element-details-header">Elemental Composition of ${planetName}'s Crust</div>
    <div class="element-details-container">
    `;
    Object.entries(planet.composition).forEach(([elementSymbol, mass]) => {
        const elementObj = elementsData.elements.find(element => element.symbol === elementSymbol);
        const elementName = elementObj ? elementObj.name : elementSymbol; 
        elementDetails += `<div class="element-detail">${elementName}: ${mass.toExponential(2)} kg</div>`;
    });

    elementDetails += `</div>`;

    const planetDetailsContent = `
        <div class="planet-details-header">Planet Details</div>
        <div class="planet-details-grid">
            <span>Name: ${planetName}</span>
            <span>Type: ${planet.type}</span>
            <span>Orbit Radius: ${planet.orbitRadius.toFixed(2)} AU</span>
            <span>Size: ${planet.radius.toFixed(2)}</span>
            <span>Moons: ${planet.moons || 'N/A'}</span>
            <span>Axial Tilt: ${planet.axialTilt.toFixed(2)}°</span>

            <span>Atmosphere: ${atmosphereFormatted}</span>
            <span>Surface Temperature: ${planet.surfaceTemperature.toFixed(2)}°C</span>
            <span>Day: ${rotationPeriodHours} hours</span>
            <span>Year: ${localDaysPerOrbitValue} days (${orbitalPeriodDays} Earth days)</span>
            <span>In Habitable Zone: ${habitableZoneStatus}</span>
            <span>Hospitable: ${hospitableStatus}</span>

        </div>
    `;

    const graphContainer = `
    <div class="graph-container">
        <canvas id="elementAbundanceGraph"></canvas>
    </div>
`;


let leftColumnContent = `
<div class="left-column">
    ${planetDetailsContent}
    ${elementDetails}
    <div class="graph-container">
        <canvas id="elementAbundanceGraph"></canvas>
    </div>
</div>`;

const geologicalData = planet.geologicalData;
const interiorCompositionHtml = `
<div class="interior-composition-container">
    <ul class="interior-composition-list">
        <li>Core: ${geologicalData.core.size.toLocaleString()} M thick, Volume: ${geologicalData.core.volume.toLocaleString()} m&sup3;</li>
        <li>Mantle: ${geologicalData.mantle.thickness.toLocaleString()} M thick, Volume: ${geologicalData.mantle.volume.toLocaleString()} m&sup3;</li>
        <li>Crust: ${geologicalData.crust.thickness.toLocaleString()} M thick, Volume: ${geologicalData.crust.volume.toLocaleString()} m&sup3;</li>
    </ul>
</div>
`;

let atmosphereCompositionContent = '<div class="composition-container">';
const atmosphereDetails = getAtmosphereDetailsForDisplay(planet.atmosphere).split(', ');
atmosphereDetails.forEach(detail => {
    atmosphereCompositionContent += `<div class="composition-item">${detail}</div>`;
});
atmosphereCompositionContent += '</div>';

let rightColumnContent = `
<div class="right-column">
    <h3 class="section-header">Atmosphere Composition</h3>
    ${atmosphereCompositionContent}
    <h3 class="section-header">Interior Composition</h3>
    ${interiorCompositionHtml}
</div>`;

habitablePlanetDiv.innerHTML = `${leftColumnContent}${rightColumnContent}`;
     plotElementProbabilityGraph(planet.composition);

}

function plotElementProbabilityGraph(planetComposition) {
    const elementSymbols = Object.keys(planetComposition);
    const masses = elementSymbols.map(symbol => planetComposition[symbol]);

    const labels = elementSymbols.map(symbol => {
        const elementObj = elementsData.elements.find(element => element.symbol === symbol);
        return elementObj ? elementObj.name : symbol; // Use element name if available
    });

    const ctx = document.getElementById('elementAbundanceGraph').getContext('2d');
const chart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: labels.map(label => label.toUpperCase()), 
        datasets: [{
            label: 'ELEMENTAL COMPOSITION (KG)',
            data: masses,
            backgroundColor: 'rgba(54, 162, 235, 0.2)',
            borderColor: '#cc77ff',
            borderWidth: 1
        }]
    },
    options: {
        spanGaps: false,
        cubicInterpolationMode: "default",
        tension: 0.2,
        scales: {
            y: {
                beginAtZero: false,
                type: 'logarithmic',
                position: 'left',
                ticks: {
                    color: '#cc77ff',
                    callback: function(value) {
                        return Number(value).toExponential();
                    }
                }
            },
            x: {
                ticks: {
                    color: '#cc77ff',
                    font: {
                        family: 'Antonio', 
                        size: 12 
                    }
                }
            }
        },
        plugins: {
            legend: {
                labels: {
                    color: '#cc77ff',
                    font: {
                        family: 'Antonio',
                        size: 14
                    },
                    textTransform: 'uppercase' 
                }
            }
        }
    }
});

}

function generateSystemName() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let name = 'P'; // Start with 'P' 
    for (let i = 0; i < 3; i++) {
        name += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    name += '-';
    for (let i = 0; i < 3; i++) {
        name += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    universeData.systemName = name;
}

function generatePlanetName(planetIndex) {
    return `${universeData.systemName}/${planetIndex}`;
}

function formatElementName(element) {
    return element.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function calculateStarColorAndIntensity(starType, starLuminosity) {
    const temperatures = {
        'O': 35000,
        'B': 20000,
        'A': 8750,
        'F': 6750,
        'G': 5750,
        'K': 4250,
        'M': 3250
    };

    let baseTemperature = temperatures[starType] || 5800;
    let variedTemperature = applyVisualTemperatureVariance(baseTemperature);
    let color = temperatureToRGB(variedTemperature);
    const baseIntensity = 1;
    let intensity = Math.min(baseIntensity * starLuminosity, 300);
    return { color, intensity };
}

function calculateStarTemperature(starType) {
    switch(starType) {
        case 'M': return 3250;
        case 'K': return 4250;
        case 'G': return 5750; 
        case 'F': return 6750;
        case 'A': return 8750;
        case 'B': return 20000;
        case 'O': return 35000;
        default: return 5500;
    }
}

function desaturateColor(color, factor) {
    const white = new THREE.Color(0xffffff);
    const originalColor = new THREE.Color(color);
    const desaturatedColor = originalColor.lerp(white, factor);
    return desaturatedColor.getStyle();
}

function applyVisualTemperatureVariance(baseTemperature) {
    const variancePercentage = 0.05; 
    const varianceAmount = baseTemperature * variancePercentage;
    const variedTemperature = baseTemperature + (Math.random() * 2 - 1) * varianceAmount;
    return variedTemperature;
}

function temperatureToRGB(temperature) {
    const minTemp = 3000;
    const maxTemp = 40000;

    const t = (Math.min(Math.max(temperature, minTemp), maxTemp) - minTemp) / (maxTemp - minTemp);
    const colors = {
        red: [255, 0, 0],
        yellow: [255, 255, 0],
        white: [255, 255, 255],
        lightBlue: [173, 216, 230],
        blue: [0, 0, 255]
    };
    let color;
    if (t < 0.25) {
        color = interpolateColors(colors.red, colors.yellow, t / 0.25);
    } else if (t < 0.5) {
        color = interpolateColors(colors.yellow, colors.white, (t - 0.25) / 0.25);
    } else if (t < 0.75) {
        color = interpolateColors(colors.white, colors.lightBlue, (t - 0.5) / 0.25);
    } else {
        color = interpolateColors(colors.lightBlue, colors.blue, (t - 0.75) / 0.25);
    }
    return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function interpolateColors(color1, color2, factor) {
    const result = color1.slice();
    for (let i = 0; i < 3; i++) {
        result[i] = Math.round(result[i] + factor * (color2[i] - color1[i]));
    }
    return result;
}

function getAtmosphereColor(composition) {
    const baseColors = {
        'trace': '#E0E0E0',
        'carbon_dioxide_type_I': '#E57373',
        'carbon_dioxide_type_II': '#B71C1C',
        'hydrogen_helium_type_I': '#FFF59D',
        'hydrogen_helium_type_II': '#FFCC80',
        'hydrogen_helium_type_III': '#FFE0B2',
        'ice_type_I': '#B2EBF2',
        'ice_type_II': '#64B5F6',
        'nitrogen_type_I': '#81D4FA',
        'nitrogen_type_II': '#42A5F5',
        'nitrogen_type_III': '#4FC3F7',
        'carbon_type_I': '#CE93D8',
        'ammonia_type_I': '#AED581',
        'unknown': '#add8e6'
    };

    function applyRandomVariation(color) {
        let rgb = parseInt(color.substring(1), 16);
        let r = (rgb >> 16) & 0xFF;
        let g = (rgb >> 8) & 0xFF;
        let b = rgb & 0xFF;
        r = Math.min(255, Math.max(0, r + Math.floor(Math.random() * 11) - 5));
        g = Math.min(255, Math.max(0, g + Math.floor(Math.random() * 11) - 5));
        b = Math.min(255, Math.max(0, b + Math.floor(Math.random() * 11) - 5));
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    if (baseColors[composition]) {
        return applyRandomVariation(baseColors[composition]);
    } else {
        return applyRandomVariation(baseColors['unknown']);
    }
}

function calculateAtmosphereScale(planetRadius) {
  const baseScale = 1.025; 
  const scaleRate = 0.01;
  const atmosphereScale = baseScale + (planetRadius * scaleRate);
  const maxScale = 1.1;
  return Math.min(atmosphereScale, maxScale);

}

function createAtmosphere(planetRadius, composition, planetType) {
  const atmosphereScaleFactor = calculateAtmosphereScale(planetRadius);
  const atmosphereRadius = planetRadius * atmosphereScaleFactor;
  const geometry = new THREE.SphereGeometry(atmosphereRadius, 32, 32);
  const color = getAtmosphereColor(composition);
  const planetColor = getColorForPlanetType(planetType);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            atmosphereColor: { value: new THREE.Color(color) },
            surfaceColor: { value: new THREE.Color(planetColor) },
        },
        vertexShader: /* glsl */`
            varying vec3 vertexNormal;
            void main() {
                vertexNormal = normalize(normalMatrix * normal); // Normal in view space
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform vec3 atmosphereColor;
            uniform vec3 surfaceColor;
            varying vec3 vertexNormal;
            void main() {
                // Calculate intensity based on the angle to the view direction
                float viewAngle = dot(vertexNormal, vec3(0, 0, 1));
                float atmosphereEffect = smoothstep(0.0, 1.0, pow(1.0 - viewAngle, 2.0));
                float intensity = pow(0.6 - dot(vertexNormal, vec3(0, 0, 1)), 2.0);
  					gl_FragColor = vec4(atmosphereColor, intensity * 0.5); // reduce intensity for a subtler effect

                // Mix the surface color and the atmosphere color based on the calculated effect
                vec3 finalColor = mix(surfaceColor, atmosphereColor, atmosphereEffect);

                // Output the final color with the alpha representing the atmosphere effect
                gl_FragColor = vec4(finalColor, atmosphereEffect);
            }
        `,
        side: THREE.BackSide,
        blending: THREE.NormalBlending,
        transparent: true
    });

    return new THREE.Mesh(geometry, material);
}

function createSegmentedRings(planetRadius, planetType, planetData) {
    const ringSegmentsGroup = new THREE.Group();
    const numSegments = Math.floor(Math.random() * (20 - 5 + 1)) + 5;
    let currentOuterRadius = planetRadius * 1.2; 

    for (let i = 0; i < numSegments; i++) {
        const segmentWidth = Math.random() * 0.2 + 0.05;
        const innerRadius = currentOuterRadius;
        const outerRadius = innerRadius + segmentWidth;

        const distanceVariance = Math.random() * 0.05 + 0.01; 
        currentOuterRadius += distanceVariance; 

        const ringGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 64, 1);
        const ringMaterial = new THREE.MeshStandardMaterial({
            color: ringColor(planetType), 
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.4 + Math.random() * 0.5 
        });

        const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
        const axialTiltRadians = THREE.Math.degToRad(planetData.axialTilt);

        ringMesh.rotation.x = Math.PI / 2;
        ringMesh.receiveShadow = true;
        ringMesh.castShadow = true;
        ringSegmentsGroup.add(ringMesh);

        
        currentOuterRadius = outerRadius + distanceVariance;
    }
    
    let outerRadius = planetRadius * 1.2;
    return {
        group: ringSegmentsGroup, // The group containing all segments
        outerRadius: outerRadius  // The final outer radius of the rings
    };
}

function createMoonsForPlanet(planetMesh, planetData, planetIndex) {
    const moons = [];
    const baseDistanceFromPlanet = planetData.radius * 10.0;

    for (let i = 0; i < planetData.moons; i++) {
        const moonScaleFactor = Math.max(planetData.radius / 5, 0.05);
        const moonRandomSize = Math.random();
        const moonGeometry = new THREE.SphereGeometry(moonRandomSize * moonScaleFactor, 32, 32);
        const moonMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
        const moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);

        moonMesh.name = `moon${planetIndex}_${i}`;

        const distanceIncrement = i * (planetData.radius * 0.2);
        const distanceFromPlanetAdjusted = baseDistanceFromPlanet + distanceIncrement;
        
        const orbitalInclination = (Math.random() - 0.5) * Math.PI;
        const orbitalPhase = Math.random() * Math.PI * 2; 

        moonMesh.position.set(
            Math.cos(orbitalPhase) * distanceFromPlanetAdjusted,
            Math.sin(orbitalPhase) * Math.sin(orbitalInclination) * distanceFromPlanetAdjusted,
            Math.sin(orbitalPhase) * Math.cos(orbitalInclination) * distanceFromPlanetAdjusted
        );

        moonMesh.userData.orbit = {
            radius: distanceFromPlanetAdjusted,
            inclination: orbitalInclination,
            phase: orbitalPhase,
            speed: 0.000005 
        };

        planetMesh.add(moonMesh);
        moons.push(moonMesh);
    }
    return moons;
}

function createNoiseTexture(size = 1024) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    const imageData = context.createImageData(size, size);

    for (let i = 0; i < imageData.data.length; i += 4) {
        // Generate random grayscale value
        const val = Math.floor(Math.random() * 255);
        imageData.data[i] = val;     // Red
        imageData.data[i + 1] = val; // Green
        imageData.data[i + 2] = val; // Blue
        imageData.data[i + 3] = 255; // Alpha
    }

    context.putImageData(imageData, 0, 0);

    return new THREE.CanvasTexture(canvas);
}

function createStarFieldTexture(size = 2048, stars = 10000) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    // Fill the background with black
    context.fillStyle = 'black';
    context.fillRect(0, 0, size, size);

    // Draw stars
    for (let i = 0; i < stars; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const radius = Math.random() * 1.5; // Vary the size for a bit of variation
        const alpha = 0.5 + Math.random() * 0.5; // Vary the opacity

        context.beginPath();
        context.arc(x, y, radius, 0, 2 * Math.PI);
        context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        context.fill();
    }

    return new THREE.CanvasTexture(canvas);
}

function ringColor(planetType) {
    let colorHex = 0xada9a1; 

    switch (planetType) {
        case 'Gas Giant':
            colorHex = 0xd2b48c;
            break;
        case 'Ice Giant':
            colorHex = 0xadd8e6; 
            break;
        default:
    }

    return new THREE.Color(colorHex);
}

const ROTATION_SPEED_SCALE = 0.001; 
const ORBITAL_SPEED_SCALE = 0.000000048; 
const LOCAL_DAY_SCALE = 1.00;

function rotationSpeedToEarthHours(rotationSpeed) {
    const rotationPeriodHours = (2 * Math.PI / Math.abs(rotationSpeed)) * ROTATION_SPEED_SCALE;
    return rotationPeriodHours;
}

function orbitalSpeedToEarthDays(orbitalSpeed, orbitRadiusAU) {
    const orbitalPeriodDays = (2 * Math.PI * orbitRadiusAU / orbitalSpeed) * ORBITAL_SPEED_SCALE;
    return orbitalPeriodDays;
}

function localDaysPerOrbit(rotationSpeed, orbitalSpeed, orbitRadiusAU) {
    const rotationPeriodHours = rotationSpeedToEarthHours(rotationSpeed);
    const orbitalPeriodDays = orbitalSpeedToEarthDays(orbitalSpeed, orbitRadiusAU);
    const rotationPeriodDays = rotationPeriodHours / 24;
    const localDays = orbitalPeriodDays / rotationPeriodDays;
    return localDays;
}

function displayTimeConversions(selectedPlanetIndex) {
    const planet = universeData.solarSystem[selectedPlanetIndex];

    const rotationPeriodHours = rotationSpeedToEarthHours(planet.rotationSpeed);
    const orbitalPeriodDays = orbitalSpeedToEarthDays(planet.orbitalSpeed, planet.orbitRadius);
    const localDays = localDaysPerOrbit(planet.rotationSpeed, planet.orbitalSpeed, planet.orbitRadius);

}

function getRotationSpeed(orbitRadius, habitableZone, AU_TO_SCENE_SCALE, systemOuterEdge) {
    let orbitRadiusAU = orbitRadius / AU_TO_SCENE_SCALE;
    
    let systemSizeAU = systemOuterEdge / AU_TO_SCENE_SCALE;
    let distancePercentage = orbitRadiusAU / systemSizeAU;

    let habitableZoneWidth = habitableZone.outerBoundary - habitableZone.innerBoundary;
    let scalingFactor = 1 + (habitableZoneWidth / 2); 
    
    let randomFactor = Math.random() * scalingFactor;
    
    let baseRotationSpeed = 0.0001 + (distancePercentage * randomFactor * 0.0001);

    let habCenterAU = (habitableZone.innerBoundary + habitableZone.outerBoundary) / 2;
    let distanceFromCenter = Math.abs(orbitRadiusAU - habCenterAU) / habCenterAU;
    let speedModifier = Math.max(0.5, 1 - distanceFromCenter); 
    let finalRotationSpeed = baseRotationSpeed * speedModifier;
    finalRotationSpeed = Math.max(0.00001, Math.min(finalRotationSpeed, 0.0005)); 

    finalRotationSpeed *= Math.random() < 0.5 ? 1 : -1;

    return finalRotationSpeed;
}

