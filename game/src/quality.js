// Quality presets. ULTRA is the default: this game spends its budget on image quality.
export const PRESETS = {
  ULTRA: {
    label: 'ULTRA', targetHeight: 1080, maxPixelRatio: 3, ao: true, aoHalf: false, aoQuality: 'High',
    msaa: 4, smaa: true, bloom: 1.15, bloomLevels: 9, roadReflection: 0.6, waterReflection: 0.45,
    envSize: 256, envEvery: 1, buildingDensity: 1.0, traffic: 26, oncoming: 16, lensBlur: 1,
  },
  HIGH: {
    label: 'HIGH', targetHeight: 900, maxPixelRatio: 2.5, ao: true, aoHalf: true, aoQuality: 'Medium',
    msaa: 4, smaa: true, bloom: 1.1, bloomLevels: 8, roadReflection: 0.5, waterReflection: 0.35,
    envSize: 192, envEvery: 2, buildingDensity: 0.85, traffic: 22, oncoming: 12, lensBlur: 1,
  },
  MEDIUM: {
    label: 'MEDIUM', targetHeight: 720, maxPixelRatio: 2, ao: false, aoHalf: true, aoQuality: 'Low',
    msaa: 4, smaa: false, bloom: 1.0, bloomLevels: 7, roadReflection: 0.4, waterReflection: 0,
    envSize: 128, envEvery: 4, buildingDensity: 0.7, traffic: 18, oncoming: 8, lensBlur: 1,
  },
  LOW: {
    label: 'LOW', targetHeight: 540, maxPixelRatio: 1.5, ao: false, aoHalf: true, aoQuality: 'Performance',
    msaa: 0, smaa: true, bloom: 0.9, bloomLevels: 6, roadReflection: 0, waterReflection: 0,
    envSize: 64, envEvery: 0, buildingDensity: 0.5, traffic: 14, oncoming: 6, lensBlur: 0,
  },
};

export const QUALITY_ORDER = ['ULTRA', 'HIGH', 'MEDIUM', 'LOW'];
