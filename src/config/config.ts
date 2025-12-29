// EmbroCAD configuration - centralized settings for the application

export const config = {
  // Thread rendering settings
  thread: {
    width: 1.5, // Base thread width in pixels
    minWidth: 1.5, // Minimum thread width at small scales
    maxWidth: 4.0, // Maximum thread width at large scales
    shadowFactor: 0.4, // How dark the shadow is (0-1, lower = darker)
    highlightFactor: 0.4, // How light the highlight is (0-1, higher = lighter)
    shadowOffset: 0.3, // Shadow offset as fraction of thread width
  },

  // Canvas settings
  canvas: {
    padding: 50, // Padding around the design in pixels
    maxSize: 1200, // Maximum canvas dimension
    backgroundColor: "#ffffff",
  },

  // Color palette - RGB values for thread colors
  colors: [
    { r: 0, g: 0, b: 0 }, // 0: Black
    { r: 26, g: 26, b: 140 }, // 1: Navy Blue
    { r: 10, g: 95, b: 28 }, // 2: Dark Green
    { r: 140, g: 26, b: 26 }, // 3: Dark Red
    { r: 140, g: 26, b: 107 }, // 4: Purple
    { r: 92, g: 77, b: 26 }, // 5: Brown
    { r: 140, g: 140, b: 140 }, // 6: Gray
    { r: 77, g: 77, b: 77 }, // 7: Dark Gray
    { r: 51, g: 102, b: 204 }, // 8: Blue
    { r: 51, g: 204, b: 102 }, // 9: Green
    { r: 204, g: 51, b: 51 }, // 10: Red
    { r: 204, g: 102, b: 204 }, // 11: Pink
    { r: 204, g: 204, b: 51 }, // 12: Yellow
    { r: 230, g: 230, b: 230 }, // 13: White
    { r: 26, g: 26, b: 26 }, // 14: Charcoal
  ],

  // Supported file formats
  formats: {
    supported: [".dst"],
  },
} as const;

// Type exports for use in components
export type ThreadColor = (typeof config.colors)[number];
