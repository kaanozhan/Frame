//! Parsing utilities.

/// Parse an input line into whitespace-separated tokens.
pub fn parse(line: &str) -> Vec<&str> {
    line.split_whitespace().collect()
}

/// A parsed document.
pub struct Document {
    pub tokens: Vec<String>,
}
