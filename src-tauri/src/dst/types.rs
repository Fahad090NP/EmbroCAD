use serde::Serialize;

/// Represents the type of command for a stitch operation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[allow(dead_code)]
pub enum StitchCommand {
    /// Regular stitch - needle penetrates fabric
    Stitch,
    /// Jump/Move without stitching
    Move,
    /// Trim the thread
    Trim,
    /// Color change - switch to next thread
    ColorChange,
    /// Sequin mode toggle
    SequinMode,
    /// Sequin eject
    SequinEject,
    /// End of pattern
    End,
}

/// Represents a single stitch with coordinates and command type
#[derive(Debug, Clone, Serialize)]
pub struct Stitch {
    pub x: f64,
    pub y: f64,
    pub command: StitchCommand,
}

impl Stitch {
    pub fn new(x: f64, y: f64, command: StitchCommand) -> Self {
        Self { x, y, command }
    }
}

/// Metadata extracted from DST file header
#[derive(Debug, Clone, Default, Serialize)]
pub struct PatternMetadata {
    pub label: Option<String>,
    pub stitch_count: Option<u32>,
    pub color_count: Option<u32>,
}

/// Bounding box of the pattern
#[derive(Debug, Clone, Serialize)]
pub struct Bounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl Bounds {
    pub fn new() -> Self {
        Self {
            min_x: f64::INFINITY,
            min_y: f64::INFINITY,
            max_x: f64::NEG_INFINITY,
            max_y: f64::NEG_INFINITY,
        }
    }

    pub fn update(&mut self, x: f64, y: f64) {
        if x < self.min_x {
            self.min_x = x;
        }
        if x > self.max_x {
            self.max_x = x;
        }
        if y < self.min_y {
            self.min_y = y;
        }
        if y > self.max_y {
            self.max_y = y;
        }
    }

    #[allow(dead_code)]
    pub fn width(&self) -> f64 {
        self.max_x - self.min_x
    }

    #[allow(dead_code)]
    pub fn height(&self) -> f64 {
        self.max_y - self.min_y
    }
}

impl Default for Bounds {
    fn default() -> Self {
        Self::new()
    }
}

/// The complete embroidery pattern
#[derive(Debug, Clone, Default, Serialize)]
pub struct Pattern {
    pub stitches: Vec<Stitch>,
    pub metadata: PatternMetadata,
    pub bounds: Option<Bounds>,
    pub color_changes: u32,
}

impl Pattern {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a stitch to the pattern
    pub fn add_stitch(&mut self, x: f64, y: f64, command: StitchCommand) {
        self.stitches.push(Stitch::new(x, y, command));

        // Track color changes
        if command == StitchCommand::ColorChange {
            self.color_changes += 1;
        }
    }

    /// Calculate the bounds of the pattern
    pub fn calculate_bounds(&mut self) {
        let mut bounds = Bounds::new();

        for stitch in &self.stitches {
            bounds.update(stitch.x, stitch.y);
        }

        if !self.stitches.is_empty() {
            self.bounds = Some(bounds);
        }
    }
}
