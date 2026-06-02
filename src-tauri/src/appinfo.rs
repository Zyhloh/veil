use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub struct ResolvedLaunch {
    pub exe: String,
    pub workdir: String,
    pub args: Vec<String>,
}

const MAGIC_27: u32 = 0x0756_4427;
const MAGIC_28: u32 = 0x0756_4428;
const MAGIC_29: u32 = 0x0756_4429;

struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn u8(&mut self) -> Option<u8> {
        let b = *self.buf.get(self.pos)?;
        self.pos += 1;
        Some(b)
    }

    fn u32(&mut self) -> Option<u32> {
        let slice = self.buf.get(self.pos..self.pos + 4)?;
        self.pos += 4;
        Some(u32::from_le_bytes(slice.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        let slice = self.buf.get(self.pos..self.pos + 8)?;
        self.pos += 8;
        Some(u64::from_le_bytes(slice.try_into().ok()?))
    }

    fn i64(&mut self) -> Option<i64> {
        let slice = self.buf.get(self.pos..self.pos + 8)?;
        self.pos += 8;
        Some(i64::from_le_bytes(slice.try_into().ok()?))
    }

    fn skip(&mut self, n: usize) {
        self.pos = (self.pos + n).min(self.buf.len());
    }

    fn cstring(&mut self) -> Option<String> {
        let start = self.pos;
        while self.pos < self.buf.len() && self.buf[self.pos] != 0 {
            self.pos += 1;
        }
        let s = String::from_utf8_lossy(&self.buf[start..self.pos]).into_owned();
        self.pos += 1;
        Some(s)
    }

    fn wstring(&mut self) -> Option<String> {
        let mut units = Vec::new();
        loop {
            let lo = self.u8()? as u16;
            let hi = self.u8()? as u16;
            let unit = lo | (hi << 8);
            if unit == 0 {
                break;
            }
            units.push(unit);
        }
        Some(String::from_utf16_lossy(&units))
    }
}

fn read_object(c: &mut Cursor, strings: Option<&[String]>) -> Option<Value> {
    let mut map = Map::new();
    loop {
        let kind = c.u8()?;
        if kind == 0x08 || kind == 0x0B {
            break;
        }
        let name = match strings {
            Some(table) => {
                let idx = c.u32()? as usize;
                table.get(idx).cloned().unwrap_or_default()
            }
            None => c.cstring()?,
        };
        let value = match kind {
            0x00 => read_object(c, strings)?,
            0x01 => Value::String(c.cstring()?),
            0x02 => Value::from(c.u32()? as i32),
            0x03 => {
                c.skip(4);
                Value::Null
            }
            0x04 => Value::from(c.u32()? as i32),
            0x05 => Value::String(c.wstring()?),
            0x06 => {
                c.skip(4);
                Value::Null
            }
            0x07 => Value::from(c.u64()?),
            0x0A => Value::from(c.i64()?),
            _ => return None,
        };
        map.insert(name, value);
    }
    Some(Value::Object(map))
}

fn read_string_table(buf: &[u8], offset: i64) -> Vec<String> {
    let mut c = Cursor::new(buf);
    c.pos = offset.max(0) as usize;
    let count = match c.u32() {
        Some(n) => n,
        None => return Vec::new(),
    };
    let mut out = Vec::with_capacity(count as usize);
    for _ in 0..count {
        match c.cstring() {
            Some(s) => out.push(s),
            None => break,
        }
    }
    out
}

fn join_relative(base: &Path, rel: &str) -> PathBuf {
    let mut path = base.to_path_buf();
    for part in rel.replace('\\', "/").split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        path.push(part);
    }
    path
}

fn tokenize_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for ch in s.chars() {
        match ch {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn pick_launch(root: &Value, install: &Path) -> Option<ResolvedLaunch> {
    let app = root.get("appinfo").unwrap_or(root);
    let launch = app.get("config")?.get("launch")?.as_object()?;

    let mut keys: Vec<&String> = launch.keys().collect();
    keys.sort_by_key(|k| k.parse::<u64>().unwrap_or(u64::MAX));

    let mut fallback: Option<ResolvedLaunch> = None;
    for key in keys {
        let entry = &launch[key];
        let exe_rel = entry.get("executable").and_then(Value::as_str).unwrap_or("");
        if exe_rel.is_empty() {
            continue;
        }

        let config = entry.get("config");
        let oslist = config
            .and_then(|c| c.get("oslist"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if !oslist.is_empty()
            && !oslist
                .split(',')
                .any(|o| o.trim().eq_ignore_ascii_case("windows"))
        {
            continue;
        }
        let betakey = config
            .and_then(|c| c.get("betakey"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if !betakey.is_empty() {
            continue;
        }

        let exe_abs = join_relative(install, exe_rel);
        if !exe_abs.exists() {
            continue;
        }

        let workdir = entry.get("workingdir").and_then(Value::as_str).unwrap_or("");
        let workdir_abs = if workdir.is_empty() {
            exe_abs
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| install.to_path_buf())
        } else {
            join_relative(install, workdir)
        };

        let args = tokenize_args(entry.get("arguments").and_then(Value::as_str).unwrap_or(""));

        let resolved = ResolvedLaunch {
            exe: exe_abs.to_string_lossy().into_owned(),
            workdir: workdir_abs.to_string_lossy().into_owned(),
            args,
        };

        let kind = entry.get("type").and_then(Value::as_str).unwrap_or("");
        if kind.is_empty() || kind.eq_ignore_ascii_case("default") || kind.eq_ignore_ascii_case("none") {
            return Some(resolved);
        }
        if fallback.is_none() {
            fallback = Some(resolved);
        }
    }
    fallback
}

pub fn resolve_launches(
    steam_path: &str,
    install_dirs: &HashMap<u32, PathBuf>,
) -> HashMap<u32, ResolvedLaunch> {
    let mut result = HashMap::new();
    if install_dirs.is_empty() {
        return result;
    }

    let path = Path::new(steam_path).join("appcache").join("appinfo.vdf");
    let buf = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return result,
    };

    let mut c = Cursor::new(&buf);
    let magic = match c.u32() {
        Some(m) => m,
        None => return result,
    };
    if magic != MAGIC_27 && magic != MAGIC_28 && magic != MAGIC_29 {
        return result;
    }
    let _universe = c.u32();

    let strings = if magic == MAGIC_29 {
        let offset = c.i64().unwrap_or(0);
        Some(read_string_table(&buf, offset))
    } else {
        None
    };
    let has_binary_hash = magic == MAGIC_28 || magic == MAGIC_29;

    loop {
        let app_id = match c.u32() {
            Some(a) => a,
            None => break,
        };
        if app_id == 0 {
            break;
        }
        let size = match c.u32() {
            Some(s) => s as usize,
            None => break,
        };
        let entry_end = c.pos + size;
        if entry_end > buf.len() {
            break;
        }

        if let Some(install) = install_dirs.get(&app_id) {
            c.u32();
            c.u32();
            c.u64();
            c.skip(20);
            c.u32();
            if has_binary_hash {
                c.skip(20);
            }
            if let Some(root) = read_object(&mut c, strings.as_deref()) {
                if let Some(resolved) = pick_launch(&root, install) {
                    result.insert(app_id, resolved);
                }
            }
        }

        c.pos = entry_end;
    }

    result
}
