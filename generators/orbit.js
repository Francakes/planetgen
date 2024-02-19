// Courtesy of bryc and Bob Jenkins
function splitmix32(a) {
    return function() {
      a |= 0; a = a + 0x9e3779b9 | 0;
      var t = a ^ a >>> 16; t = Math.imul(t, 0x21f0aaad);
          t = t ^ t >>> 15; t = Math.imul(t, 0x735a2d97);
      return ((t = t ^ t >>> 15) >>> 0) / 4294967296;
    }
}

var SEED = Date.now();

var random = splitmix32(SEED);

export function set_random_seed(seed) {
    random = splitmix32(seed);
}

function getRandomValue(min, max) {
    return random() * (max - min) + min;
}

function generateOrbit(seed = null) {
    if (seed != null)
    {
        set_random_seed(seed);
    }

    const parentStar = generateParentStar();
    const luminosity = generateStarLuminosity(parentStar.type, parentStar.size);
    parentStar.habitableZone = calculateHabitableZone(luminosity);
    const solarSystem = generateSolarSystem(parentStar);

    return {
        parentStar: parentStar,
        solarSystem: solarSystem,
        habitableZone: parentStar.habitableZone
    };
}

function generateParentStar() {
    const starTypes = ["M", "K", "G", "F", "A", "B", "O"];
    const type = starTypes[Math.floor(random() * starTypes.length)];

    const age = generateStarAge(type);
    const { size, mass } = generateStarSizeAndMass(type, age);
    const luminosity = generateStarLuminosity(type, size);

    return {
        type: type,
        age: age,
        size: size,
        mass: mass,
        luminosity: luminosity
    };
}

function calculateHabitableZone(luminosity) {
    const innerBoundary = Math.sqrt(luminosity / 1.1);
    const outerBoundary = Math.sqrt(luminosity / 0.53);

    return {
        innerBoundary: innerBoundary,
        outerBoundary: outerBoundary
    };
}

function generateStarAge(type) {
    let age;
    switch (type) {
        case "M":
            age = getRandomAge(1, 5000); 
            break;
        case "K":
            age = getRandomAge(1, 30); 
            break;
        case "G":
            age = getRandomAge(1, 10); 
            break;
        case "F":
            age = getRandomAge(1, 4); 
            break;
        case "A":
            age = getRandomAge(0.1, 3); 
            break;
        case "B":
            age = getRandomAge(0.01, 0.5); 
            break;
        case "O":
            age = getRandomAge(0.001, 0.1); 
            break;
        default:
            age = 0;
    }
    return age;
}

function getRandomAge(min, max) {
    return random() * (max - min) + min;
}

function generateStarSizeAndMass(type, age) {
    let size; 
    let mass;

    switch (type) {
        case "M":
            size = getRandomValue(0.1, 0.7); 
            mass = getRandomValue(0.08, 0.45); 
            break;
        case "K":
            size = getRandomValue(0.7, 0.96);
            mass = getRandomValue(0.45, 0.8);
            break;
        case "G":
            size = getRandomValue(0.96, 1.15);
            mass = getRandomValue(0.8, 1.04);
            break;
        case "F":
            size = getRandomValue(1.15, 1.4);
            mass = getRandomValue(1.04, 1.4);
            break;
        case "A":
            size = getRandomValue(1.4, 1.8);
            mass = getRandomValue(1.4, 2.1);
            break;
        case "B":
            size = getRandomValue(1.8, 6.6);
            mass = getRandomValue(2.1, 16);
            break;
        case "O":
            size = getRandomValue(6.6, 20);
            mass = getRandomValue(16, 90);
            break;
        default:
            size = 0;
            mass = 0;
    }

    return { size, mass };
}


function generateStarLuminosity(type, size) {
    let luminosity;

    switch (type) {
        case "M":
            luminosity = size * 0.08;
            break;
        case "K":
            luminosity = size * 0.6;
            break;
        case "G":
            luminosity = size;
            break;
        case "F":
            luminosity = size * 1.5;
            break;
        case "A":
            luminosity = size * 5;
            break;
        case "B":
            luminosity = size * 25;
            break;
        case "O":
            luminosity = size * 50;
            break;
        default:
            luminosity = 0;
    }

    return luminosity;
}

function generateSolarSystem(parentStar) {
    const numberOfPlanets = getRandomInt(3, 18);
    let solarSystemPlanets = [];
    let habitableZonePlanetAdded = false;

    for (let i = 0; i < numberOfPlanets; i++) {
        const orbitRadius = getRandomOrbitRadius(parentStar, i, numberOfPlanets);
        const planetType = determinePlanetType(parentStar, orbitRadius, habitableZonePlanetAdded);
        const planetSize = getPlanetSize(planetType); 
        const planetAtmosphere = getPlanetAtmosphere(planetType, orbitRadius, parentStar.habitableZone);
        const planetMoons = getPlanetMoons(planetType); 
        const axialTilt = getAxialTilt(planetType);
        if (isInHabitableZone(orbitRadius, parentStar.habitableZone)) {
            habitableZonePlanetAdded = true;
        }

        solarSystemPlanets.push({
            type: planetType,
            orbitRadius: orbitRadius,
            size: planetSize,
        	radius: planetSize,
            atmosphere: planetAtmosphere,
            moons: planetMoons,
            axialTilt
        });
    }

	    if (!habitableZonePlanetAdded) {
	        adjustForHabitableZonePlanet(solarSystemPlanets, parentStar.habitableZone);
    }
    solarSystemPlanets.sort((a, b) => a.orbitRadius - b.orbitRadius);
    return solarSystemPlanets;
}

function getRandomOrbitRadius(parentStar, planetIndex, totalPlanets) {
    const luminosity = parentStar.luminosity; 
    const innerHabitable = Math.sqrt(luminosity / 1.1);
    const outerHabitable = Math.sqrt(luminosity / 0.53);

    const minOrbit = 0.2; 
    const maxOrbit = Math.max(50, outerHabitable + 20); 
    const spacingFactor = (Math.log(maxOrbit) - Math.log(minOrbit)) / totalPlanets;
    return Math.exp(Math.log(minOrbit) + spacingFactor * planetIndex);
}

function getAxialTilt(planetType){
    const tiltRanges = {
        'Dwarf': { min: 0, max: 30 },
        'Terrestrial': { min: 0, max: 25 },
        'Ocean': { min: 10, max: 30 },
        'Lava': { min: 0, max: 40 },
        'Gas Giant': { min: 15, max: 90 },
        'Ice Giant': { min: 10, max: 90 },
    };
    const range = tiltRanges[planetType] || tiltRanges['Terrestrial']; 
    return Math.random() * (range.max - range.min) + range.min;
}


function determinePlanetType(parentStar, orbitRadius) {
    const luminosity = parentStar.luminosity;
    const innerHabitable = Math.sqrt(luminosity / 1.1);
    const outerHabitable = Math.sqrt(luminosity / 0.53);

    if (orbitRadius < innerHabitable) {
        return "Lava Planet";
    } else if (orbitRadius >= innerHabitable && orbitRadius <= outerHabitable) {
        return Math.random() > 0.5 ? "Terrestrial" : "Ocean World";
    } else if (orbitRadius > outerHabitable && orbitRadius < outerHabitable + 15) {
        return "Gas Giant";
    } else if (orbitRadius >= outerHabitable + 5 && orbitRadius < 30) {
        return "Ice Giant";
    } else {
        return "Dwarf Planet";
    }
}


function getPlanetSize(planetType) {
    switch (planetType) {
        case "Lava Planet":
            return getRandomValue(0.3, 1); 
        case "Terrestrial":
            return getRandomValue(0.5, 1.5);
        case "Ocean World":
            return getRandomValue(0.8, 2);
        case "Gas Giant":
            return getRandomValue(6, 15); 
        case "Ice Giant":
            return getRandomValue(5, 14);
        case "Dwarf Planet":
            return getRandomValue(0.1, 0.3);
        default:
            return 1;
    }
}


function getPlanetAtmosphere(planetType, orbitRadius, habitableZone) {
    const atmospheres = {
        'trace': ['trace'],
        'carbon_dioxide': ['carbon_dioxide_type_I', 'carbon_dioxide_type_II'],
        'hydrogen_helium': ['hydrogen_helium_type_I', 'hydrogen_helium_type_II', 'hydrogen_helium_type_III'],
        'ice': ['ice_type_I', 'ice_type_II'],
        'nitrogen': ['nitrogen_type_I', 'nitrogen_type_II', 'nitrogen_type_III'],
        'carbon': ['carbon_type_I'],
        'ammonia': ['ammonia_type_I']
    };

    const randomAtmosphere = (types) => types[Math.floor(Math.random() * types.length)];

    switch (planetType) {
        case "Terrestrial":
            if (isInHabitableZone(orbitRadius, habitableZone)) {
                return randomAtmosphere([...atmospheres['carbon_dioxide'], ...atmospheres['nitrogen']]);
            }
            return randomAtmosphere(atmospheres['carbon_dioxide']);
        case "Ocean World":
            return randomAtmosphere([...atmospheres['carbon'], ...atmospheres['ammonia'], ...atmospheres['nitrogen']]);
        case "Gas Giant":
            return randomAtmosphere([...atmospheres['hydrogen_helium'], atmospheres['carbon'][0]]);
        case "Ice Giant":
            return randomAtmosphere([...atmospheres['ice'], atmospheres['ammonia'][0]]);
        case "Lava Planet":
                return randomAtmosphere([...atmospheres['carbon_dioxide']]);
        case "Dwarf Planet":
            return randomAtmosphere([...atmospheres['trace'], ...atmospheres['carbon_dioxide']]);
        default:
            return "unknown"; 
    }
}




function getPlanetMoons(planetType) {
    switch (planetType) {
        case "Terrestrial":
            return getRandomInt(0, 3);
        case "Ocean World":
            return getRandomInt(0, 2);
        case "Gas Giant":
            return getRandomInt(1, 80); 
        case "Ice Giant":
            return getRandomInt(1, 50);
        case "Lava Planet":
            return getRandomInt(0, 2);
        case "Dwarf Planet":
            return getRandomInt(0, 5); 
        default:
            return 0;
    }
}

function getRandomInt(min, max) {
    return Math.floor(random() * (max - min + 1)) + min;
}


function adjustForHabitableZonePlanet(planets, habitableZone) {
    let habitableZonePlanetExists = planets.some(planet => isInHabitableZone(planet.orbitRadius, habitableZone));

    if (!habitableZonePlanetExists) {
        let planetToAdjust = planets[Math.floor(random() * planets.length)];
        planetToAdjust.orbitRadius = (habitableZone.innerBoundary + habitableZone.outerBoundary) / 2;
    }
}


export function isInHabitableZone(orbitRadius, habitableZone) {
    return orbitRadius >= habitableZone.innerBoundary && orbitRadius <= habitableZone.outerBoundary;
}

export { generateOrbit, generateParentStar, generateStarSizeAndMass, generateStarLuminosity, calculateHabitableZone, determinePlanetType, getPlanetAtmosphere };