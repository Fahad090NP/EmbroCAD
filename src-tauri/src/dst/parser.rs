// parser.rs - DST embroidery file format parser with stitch decoding

use crate::dst::types::{Pattern, PatternMetadata, StitchCommand};
use std::io::{Cursor, Read};

/// DST header size in bytes
const HEADER_SIZE: usize = 512;

/// Error type for DST parsing
#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum DstError {
    #[error("Invalid DST file: insufficient data")]
    InsufficientData,
    #[error("Invalid DST file format")]
    InvalidFormat,
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

/// Extract a single bit from a byte
#[inline]
fn get_bit(byte: u8, bit: u8) -> i32 {
    ((byte >> bit) & 1) as i32
}

/// Decode X displacement from 3 bytes using DST bit encoding
fn decode_dx(b0: u8, b1: u8, b2: u8) -> i32 {
    let mut x = 0i32;
    x += get_bit(b2, 2) * 81;
    x += get_bit(b2, 3) * -81;
    x += get_bit(b1, 2) * 27;
    x += get_bit(b1, 3) * -27;
    x += get_bit(b0, 2) * 9;
    x += get_bit(b0, 3) * -9;
    x += get_bit(b1, 0) * 3;
    x += get_bit(b1, 1) * -3;
    x += get_bit(b0, 0) * 1;
    x += get_bit(b0, 1) * -1;
    x
}

/// Decode Y displacement from 3 bytes using DST bit encoding
fn decode_dy(b0: u8, b1: u8, b2: u8) -> i32 {
    let mut y = 0i32;
    y += get_bit(b2, 5) * 81;
    y += get_bit(b2, 4) * -81;
    y += get_bit(b1, 5) * 27;
    y += get_bit(b1, 4) * -27;
    y += get_bit(b0, 5) * 9;
    y += get_bit(b0, 4) * -9;
    y += get_bit(b1, 7) * 3;
    y += get_bit(b1, 6) * -3;
    y += get_bit(b0, 7) * 1;
    y += get_bit(b0, 6) * -1;
    -y // Invert Y axis
}

/// Parse the DST header to extract metadata
fn parse_header(data: &[u8]) -> PatternMetadata {
    let mut metadata = PatternMetadata::default();

    if data.len() < HEADER_SIZE {
        return metadata;
    }

    // Label is at bytes 0-19 (LA: prefix at 0-2)
    if let Ok(label) = std::str::from_utf8(&data[3..19]) {
        let label = label.trim_end_matches(char::from(0)).trim();
        if !label.is_empty() {
            metadata.label = Some(label.to_string());
        }
    }

    // Stitch count is at bytes 20-27 (ST: prefix)
    if let Ok(count_str) = std::str::from_utf8(&data[23..30]) {
        let count_str = count_str.trim_end_matches(char::from(0)).trim();
        if let Ok(count) = count_str.parse::<u32>() {
            metadata.stitch_count = Some(count);
        }
    }

    // Color count is at bytes 28-35 (CO: prefix)
    if let Ok(count_str) = std::str::from_utf8(&data[31..34]) {
        let count_str = count_str.trim_end_matches(char::from(0)).trim();
        if let Ok(count) = count_str.parse::<u32>() {
            metadata.color_count = Some(count);
        }
    }

    metadata
}

/// Parse DST stitch data from the file
fn parse_stitches(data: &[u8], pattern: &mut Pattern) -> Result<(), DstError> {
    let mut cursor = Cursor::new(data);
    let mut buffer = [0u8; 3];

    let mut current_x = 0.0f64;
    let mut current_y = 0.0f64;
    let mut sequin_mode = false;

    // Statistics counters
    let mut real_stitches = 0;
    let mut jumps = 0;
    let mut color_changes = 0;

    // Constants for time estimation
    const MACHINE_SPEED_SPM: f64 = 800.0;
    const COLOR_CHANGE_PENALTY_SECONDS: f64 = 15.0;

    loop {
        if cursor.read_exact(&mut buffer).is_err() {
            break;
        }

        let b0 = buffer[0];
        let b1 = buffer[1];
        let b2 = buffer[2];

        let dx = decode_dx(b0, b1, b2) as f64;
        let dy = decode_dy(b0, b1, b2) as f64;

        current_x += dx;
        current_y += dy;

        // Check for end of pattern (0xF3 pattern)
        if b2 & 0b11110011 == 0b11110011 {
            pattern.add_stitch(current_x, current_y, StitchCommand::End);
            break;
        }
        // Color change (0xC3 pattern)
        else if b2 & 0b11000011 == 0b11000011 {
            pattern.add_stitch(current_x, current_y, StitchCommand::ColorChange);
            color_changes += 1;
        }
        // Sequin mode toggle (0x43 pattern)
        else if b2 & 0b01000011 == 0b01000011 {
            pattern.add_stitch(current_x, current_y, StitchCommand::SequinMode);
            sequin_mode = !sequin_mode;
        }
        // Move/Jump or Sequin eject (0x83 pattern)
        else if b2 & 0b10000011 == 0b10000011 {
            if sequin_mode {
                pattern.add_stitch(current_x, current_y, StitchCommand::SequinEject);
            } else {
                pattern.add_stitch(current_x, current_y, StitchCommand::Move);
                jumps += 1;
            }
        }
        // Regular stitch
        else {
            pattern.add_stitch(current_x, current_y, StitchCommand::Stitch);
            real_stitches += 1;
        }
    }

    // Populate statistics
    pattern.statistics.real_stitch_count = real_stitches;
    pattern.statistics.jump_count = jumps;
    pattern.statistics.color_change_count = color_changes;

    // Calculate estimated time
    let stitch_time_minutes = (real_stitches as f64) / MACHINE_SPEED_SPM;
    let color_change_time_minutes = (color_changes as f64 * COLOR_CHANGE_PENALTY_SECONDS) / 60.0;

    pattern.statistics.estimated_time_minutes = stitch_time_minutes + color_change_time_minutes;

    Ok(())
}

/// Parse a DST file from bytes
pub fn parse_dst(data: &[u8]) -> Result<Pattern, DstError> {
    if data.len() < HEADER_SIZE {
        return Err(DstError::InsufficientData);
    }

    let mut pattern = Pattern::new();

    // Parse header
    pattern.metadata = parse_header(data);

    // Parse stitches (data starts after header)
    parse_stitches(&data[HEADER_SIZE..], &mut pattern)?;

    // Calculate bounds
    pattern.calculate_bounds();

    Ok(pattern)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_dx() {
        // Test zero displacement
        assert_eq!(decode_dx(0, 0, 0), 0);

        // Test positive displacement (+1)
        assert_eq!(decode_dx(0b00000001, 0, 0), 1);

        // Test negative displacement (-1)
        assert_eq!(decode_dx(0b00000010, 0, 0), -1);
    }

    #[test]
    fn test_decode_dy() {
        // Test zero displacement
        assert_eq!(decode_dy(0, 0, 0), 0);

        // Note: Y is inverted in DST format
        assert_eq!(decode_dy(0b10000000, 0, 0), -1);
        assert_eq!(decode_dy(0b01000000, 0, 0), 1);
    }

    #[test]
    fn test_get_bit() {
        assert_eq!(get_bit(0b00000001, 0), 1);
        assert_eq!(get_bit(0b00000010, 1), 1);
        assert_eq!(get_bit(0b00000001, 1), 0);
    }
}
