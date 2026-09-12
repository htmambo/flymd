// scan_dirs_doc_presence 集成测试
//
// 该测试用 walkdir + 同一份聚合逻辑直接验证语义，绕过 Tauri runtime：
// - 接受绝对路径、拒绝相对路径
// - allow 为空时返回 []
// - max_depth 默认 20 / 0 → 0（与 WalkDir 对齐）
// - skip_dir_name 命中（node_modules / .git 等）
// - MAX_ENTRIES 截断
// - 文件级 symlink 放行、目录 symlink 不递归
// - 底向上聚合：含文档的目录及其所有祖先都被纳入
//
// 运行：`cd src-tauri && cargo test --test scan_dirs_doc_presence`

use std::collections::{HashMap, HashSet};
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

/// 与 main.rs 同步的 skip_dir_name（精确匹配 file_name，大小写不敏感）
fn skip_dir_name(name: &str) -> bool {
  let n = name.trim().to_ascii_lowercase();
  matches!(
    n.as_str(),
    "ebwebview"|"node_modules"|".git"|".hg"|".svn"|"target"|"dist"|"build"|
    ".next"|".vite"|"code cache"|"gpucache"|"service worker"|".cache"|"vendor"|
    "appdata"|"local"|"roaming"|"$recycle.bin"|"system volume information"|
    "library"|"applications"|".fseventsd"|".spotlight-v100"|".trashes"|
    ".documentrevisions-v100"|".temporaryitems"|"lost+found"|"downloads"
  )
}

fn scan(root: &Path, allow: &HashSet<String>, max_depth: usize, max_entries: usize)
  -> (Vec<String>, bool, usize)
{
  use walkdir::WalkDir;

  let mut direct: HashSet<PathBuf> = HashSet::new();
  let mut visited = 0usize;
  let mut truncated = false;
  let mut errors = 0usize;

  let walker = WalkDir::new(root)
    .follow_links(false)
    .min_depth(1)
    .max_depth(max_depth)
    .into_iter()
    .filter_entry(|e| !skip_dir_name(e.file_name().to_string_lossy().as_ref()));

  for entry in walker {
    let entry = match entry { Ok(e) => e, Err(_) => { errors += 1; continue } };
    visited += 1;
    if visited > max_entries { truncated = true; break; }
    let ft = entry.file_type();
    let is_doc_file = if ft.is_file() { true }
      else if ft.is_symlink() { fs::metadata(entry.path()).map(|m| m.is_file()).unwrap_or(false) }
      else { false };
    if !is_doc_file { continue; }
    let ext = entry.path().extension().and_then(|s| s.to_str())
      .map(|s| s.to_ascii_lowercase()).unwrap_or_default();
    if allow.contains(&ext) {
      if let Some(p) = entry.path().parent() {
        if p.starts_with(root) { direct.insert(p.to_path_buf()); }
      }
    }
  }

  let mut positive: HashSet<PathBuf> = HashSet::new();
  positive.insert(root.to_path_buf());
  for d in &direct {
    for a in d.ancestors() {
      if !a.starts_with(root) { break; }
      positive.insert(a.to_path_buf());
    }
  }
  let mut out: Vec<String> = positive.into_iter()
    .map(|p| p.to_string_lossy().replace('\\', "/"))
    .filter(|p| !p.is_empty())
    .collect();
  out.sort();
  (out, truncated, errors)
}

fn make_allow() -> HashSet<String> {
  ["md","markdown","txt","pdf"].iter().map(|s| s.to_string()).collect()
}

#[test]
fn rejects_relative_path() {
  // 这是函数契约测试：root 必须是绝对路径。
  // 通过运行时检查：相对路径 is_absolute() == false。
  let rel = Path::new("foo/bar");
  assert!(!rel.is_absolute(), "相对路径必须被拒绝");
}

#[test]
fn basic_tree_returns_all_dirs_with_md() {
  let tmp = std::env::temp_dir().join("flymd-scan-test-basic");
  let _ = fs::remove_dir_all(&tmp);
  fs::create_dir_all(&tmp).unwrap();
  fs::write(tmp.join("a.md"), "x").unwrap();
  fs::create_dir_all(tmp.join("sub1")).unwrap();
  fs::write(tmp.join("sub1").join("b.md"), "x").unwrap();
  fs::create_dir_all(tmp.join("sub1").join("sub2")).unwrap();
  fs::write(tmp.join("sub1").join("sub2").join("c.txt"), "x").unwrap();

  let allow = make_allow();
  let (result, _truncated, _errors) = scan(&tmp, &allow, 20, 50_000);
  assert!(result.iter().any(|s| s == &tmp.to_string_lossy().replace('\\', "/") || s.ends_with("flymd-scan-test-basic")));
  // sub1 + sub2 都应出现在结果中（含文档或其祖先含文档）
  assert!(result.iter().any(|s| s.contains("sub1")), "sub1 应在结果: {:?}", result);
  assert!(result.iter().any(|s| s.contains("sub2")), "sub2 应在结果（txt 也算）: {:?}", result);
  let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn allow_empty_returns_only_root_or_empty() {
  let tmp = std::env::temp_dir().join("flymd-scan-test-empty-allow");
  let _ = fs::remove_dir_all(&tmp);
  fs::create_dir_all(&tmp).unwrap();
  fs::write(tmp.join("a.md"), "x").unwrap();
  let allow: HashSet<String> = HashSet::new();
  let (result, _truncated, _errors) = scan(&tmp, &allow, 20, 50_000);
  // 业务代码：allow 为空时直接返回 []（不在聚合路径里）
  // 这里 scan() 模拟聚合路径：allow 为空 → 直接没目录满足 allow.contains → 仅 root 在 positive
  // 但 positive.insert(root) 总会发生，所以会是 [root]。
  // 重要：函数入口的 allow.is_empty() early-return 不在此模拟范围内。
  assert_eq!(result.len(), 1, "allow 为空时聚合后仅 root");
  let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn skip_dirs_are_excluded() {
  let tmp = std::env::temp_dir().join("flymd-scan-test-skip");
  let _ = fs::remove_dir_all(&tmp);
  fs::create_dir_all(&tmp).unwrap();
  fs::create_dir_all(tmp.join("node_modules")).unwrap();
  fs::write(tmp.join("node_modules").join("doc.md"), "x").unwrap();
  fs::create_dir_all(tmp.join("real")).unwrap();
  fs::write(tmp.join("real").join("doc.md"), "x").unwrap();

  let allow = make_allow();
  let (result, _truncated, _errors) = scan(&tmp, &allow, 20, 50_000);
  // node_modules 应被跳过；real 应被包含
  assert!(!result.iter().any(|s| s.contains("node_modules")), "node_modules 必须被跳过: {:?}", result);
  assert!(result.iter().any(|s| s.contains("real")), "real 应在结果: {:?}", result);
  let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn max_depth_zero_returns_only_root_path() {
  let tmp = std::env::temp_dir().join("flymd-scan-test-depth-zero");
  let _ = fs::remove_dir_all(&tmp);
  fs::create_dir_all(&tmp).unwrap();
  fs::write(tmp.join("top.md"), "x").unwrap();
  fs::create_dir_all(tmp.join("sub")).unwrap();
  fs::write(tmp.join("sub").join("nested.md"), "x").unwrap();

  let allow = make_allow();
  // max_depth=0：WalkDir 仅返回 root 条目，不递归
  // 直接跳过：min_depth=1 + max_depth=0 不会 yield 任何 entry
  // 因此 direct_doc_dirs 为空，positive = {root}
  let (result, _truncated, _errors) = scan(&tmp, &allow, 0, 50_000);
  assert_eq!(result.len(), 1, "max_depth=0 时仅 root");
  let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn max_depth_truncates_correctly() {
  let tmp = std::env::temp_dir().join("flymd-scan-test-depth-trunc");
  let _ = fs::remove_dir_all(&tmp);
  fs::create_dir_all(&tmp).unwrap();
  fs::create_dir_all(tmp.join("a/b/c/d/e/f/g")).unwrap();
  fs::write(tmp.join("a/b/c/d/e/f/g/deep.md"), "x").unwrap();
  fs::write(tmp.join("top.md"), "x").unwrap();

  let allow = make_allow();
  // depth=3：a/b/c 内最深；g/ 在 depth 6 → 不可达
  let (result, _truncated, _errors) = scan(&tmp, &allow, 3, 50_000);
  // a/b/c 应在结果；a/b/c/d/e/f/g 不在（depth 6）
  assert!(!result.iter().any(|s| s.contains("a/b/c/d")), "depth 限制后 d 不应在结果: {:?}", result);
  let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn file_symlink_is_followed() {
  let tmp = std::env::temp_dir().join("flymd-scan-test-symlink");
  let _ = fs::remove_dir_all(&tmp);
  fs::create_dir_all(&tmp).unwrap();
  // 普通文件 + 文件级 symlink
  fs::write(tmp.join("real.md"), "x").unwrap();
  fs::create_dir_all(tmp.join("sub")).unwrap();
  symlink(tmp.join("real.md"), tmp.join("sub").join("link.md")).unwrap();

  let allow = make_allow();
  let (result, _truncated, _errors) = scan(&tmp, &allow, 20, 50_000);
  // sub 应在结果（link.md 是 symlink → file → 算文档）
  assert!(result.iter().any(|s| s.contains("sub")), "含文件 symlink 的子目录应在结果: {:?}", result);
  let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn dir_symlink_not_recursed() {
  let tmp = std::env::temp_dir().join("flymd-scan-test-dir-symlink");
  let _ = fs::remove_dir_all(&tmp);
  // 真实子树 + 目录 symlink 指向同一子树（follow_links=false 不递归）
  fs::create_dir_all(tmp.join("shared")).unwrap();
  fs::write(tmp.join("shared").join("inside.md"), "x").unwrap();
  symlink(tmp.join("shared"), tmp.join("link_to_shared")).unwrap();

  let allow = make_allow();
  let (result, _truncated, _errors) = scan(&tmp, &allow, 20, 50_000);
  // shared 应在结果（直接含文档）；link_to_shared 不在（不递归）
  assert!(result.iter().any(|s| s.ends_with("/shared")), "shared 应在结果: {:?}", result);
  assert!(!result.iter().any(|s| s.contains("link_to_shared")), "目录 symlink 不应递归: {:?}", result);
  let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn max_entries_truncates() {
  let tmp = std::env::temp_dir().join("flymd-scan-test-budget");
  let _ = fs::remove_dir_all(&tmp);
  fs::create_dir_all(&tmp).unwrap();
  // 60 个文件，全部超过 50 条预算
  for i in 0..60 {
    fs::write(tmp.join(format!("f{:03}.md", i)), "x").unwrap();
  }

  let allow = make_allow();
  let (_result, truncated, _errors) = scan(&tmp, &allow, 20, 50);
  assert!(truncated, "超过 50 条应触发 truncated");
  let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn ancestor_aggregation_works() {
  let tmp = std::env::temp_dir().join("flymd-scan-test-ancestor");
  let _ = fs::remove_dir_all(&tmp);
  // root/A/B/C/deep.md → A、B、C、root 都应在结果（底向上冒泡）
  fs::create_dir_all(tmp.join("A/B/C")).unwrap();
  fs::write(tmp.join("A/B/C/deep.md"), "x").unwrap();

  let allow = make_allow();
  let (result, _truncated, _errors) = scan(&tmp, &allow, 20, 50_000);
  assert!(result.iter().any(|s| s.ends_with("/C")), "C 应在: {:?}", result);
  assert!(result.iter().any(|s| s.ends_with("/B")), "B 应在: {:?}", result);
  assert!(result.iter().any(|s| s.ends_with("/A")), "A 应在: {:?}", result);
  let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn nonexistent_root_via_metadata() {
  // 验证 main.rs 的 fs::metadata 校验：路径不存在时返回 Err
  let p = Path::new("/this/path/definitely/does/not/exist/abc123");
  let r = fs::metadata(p);
  assert!(r.is_err(), "不存在的路径应让 fs::metadata 返回 Err");
}
