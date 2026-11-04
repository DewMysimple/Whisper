//! Streaming structural checks. Empty transcripts are valid for silent media.
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

fn timestamp(value: &str) -> Option<u64> {
    let fields: Vec<_> = value.split([':', ',']).collect();
    if fields.len() != 4
        || fields[0].len() < 2
        || fields[1].len() != 2
        || fields[2].len() != 2
        || fields[3].len() != 3
        || fields
            .iter()
            .any(|s| !s.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let h: u64 = fields[0].parse().ok()?;
    let m: u64 = fields[1].parse().ok()?;
    let s: u64 = fields[2].parse().ok()?;
    let ms: u64 = fields[3].parse().ok()?;
    if m >= 60 || s >= 60 {
        return None;
    }
    h.checked_mul(3600000)?
        .checked_add(m * 60000 + s * 1000 + ms)
}

pub fn validate(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "txt" | "md" | "srt") {
        return Err("不支持的输出格式".into());
    }
    let mut reader = BufReader::new(File::open(path).map_err(|e| e.to_string())?);
    let mut cue_line = 0;
    let mut cue_number = 0_u64;
    loop {
        let mut line = String::new();
        // Bound a malformed single line without loading the whole output.
        let bytes = reader
            .by_ref()
            .take(1024 * 1024 + 1)
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        if bytes == 0 {
            break;
        }
        if bytes > 1024 * 1024 {
            return Err("单行过长，无法确认输出有效".into());
        }
        if line
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        {
            return Err("输出包含非文本控制字符".into());
        }
        if extension != "srt" {
            continue;
        }
        let text = line.trim();
        if text.is_empty() {
            if cue_line > 0 && cue_line < 3 {
                return Err("SRT 字幕块不完整".into());
            }
            cue_line = 0;
            continue;
        }
        match cue_line {
            0 => {
                cue_number += 1;
                if text.parse::<u64>().ok() != Some(cue_number) {
                    return Err("SRT 序号无效".into());
                }
            }
            1 => {
                let Some((start, end)) = text.split_once(" --> ") else {
                    return Err("SRT 时间码无效".into());
                };
                match (timestamp(start), timestamp(end)) {
                    (Some(a), Some(b)) if b > a => (),
                    _ => return Err("SRT 起止时间无效".into()),
                }
            }
            _ => (),
        }
        cue_line += 1;
    }
    if extension == "srt" && cue_line > 0 && cue_line < 3 {
        return Err("SRT 字幕块不完整".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checks_formats_and_allows_silent_empty_outputs() {
        let root =
            std::env::temp_dir().join(format!("whisper-output-audit-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        for (name, content, valid) in [
            ("silent.txt", "", true),
            ("silent.md", "", true),
            ("silent.srt", "", true),
            ("ok.md", "普通正文\n", true),
            ("binary.txt", "a\0b", false),
            ("ok.srt", "1\n00:00:00,000 --> 00:00:01,000\n正文\n", true),
            (
                "backwards.srt",
                "1\n00:00:02,000 --> 00:00:01,000\n正文\n",
                false,
            ),
            (
                "range.srt",
                "1\n00:61:00,000 --> 00:62:00,000\n正文\n",
                false,
            ),
            ("text.srt", "not subtitles", false),
            ("partial.srt", "1\n00:00:00,000 --> 00:00:01,000", false),
        ] {
            let path = root.join(name);
            std::fs::write(&path, content).unwrap();
            assert_eq!(validate(&path).is_ok(), valid, "{name}");
        }
        let invalid = root.join("utf8.txt");
        std::fs::write(&invalid, [0xff, 0xfe]).unwrap();
        assert!(validate(&invalid).is_err());
        assert!(validate(&root.join("missing.txt")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
