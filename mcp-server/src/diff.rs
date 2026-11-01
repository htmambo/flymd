//! 行级 unified diff。
//!
//! 不引入 `similar` / `diff` 之类第三方依赖：按最长公共子序列（LCS）自行实现，
//! 输出标准 unified diff 文本，供 `preview_write` / `write_note` 展示。
//!
//! 约定：
//! - 默认 3 行上下文，相同内容多的文件因此仍然输出紧凑；
//! - 末行没有换行符时按 git 的习惯标注 `\ No newline at end of file`；
//! - 两份内容完全相同时返回空字符串（与 `diff -u` 一致）。

/// diff 输出的上下文行数。
const CONTEXT: usize = 3;

/// LCS 动态规划允许的最大单元数（n * m）。
///
/// 超过这个规模说明两边差异极大（例如整文件重写），此时退化成
/// 「整块删除 + 整块新增」——diff 依然正确可读，但不会把内存吃光。
const MAX_LCS_CELLS: usize = 2_000_000;

/// 差异序列里的一条记录。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    /// 两边相同：`(旧行号, 新行号)`
    Equal(usize, usize),
    /// 仅旧文件有：旧行号
    Delete(usize),
    /// 仅新文件有：新行号
    Insert(usize),
}

/// diff 输出里的一行。
struct DiffLine {
    /// 行首标记：空格=上下文，`-`=删除，`+`=新增
    prefix: char,
    /// 行内容（不含行尾换行符）
    text: String,
    /// 原文件里这一行没有以换行结尾
    no_newline: bool,
}

/// 一个差异块（hunk）。
struct Hunk {
    /// 旧文件起始行号（1 基；空范围时是插入位置）
    old_start: usize,
    /// 旧文件行数
    old_count: usize,
    /// 新文件起始行号（1 基；空范围时是插入位置）
    new_start: usize,
    /// 新文件行数
    new_count: usize,
    /// 块内的行
    lines: Vec<DiffLine>,
}

/// 生成标准 unified diff。
///
/// `old_label` / `new_label` 是文件头里显示的标签（一般是相对路径）；
/// 文件原本不存在时 `old_label` 传 `/dev/null`。
/// 两份内容完全相同时返回空字符串。
pub fn unified_diff(old: &str, new: &str, old_label: &str, new_label: &str) -> String {
    let old_lines = split_lines(old);
    let new_lines = split_lines(new);
    let ops = diff_ops(&old_lines, &new_lines);
    let hunks = build_hunks(&ops, &old_lines, &new_lines);
    if hunks.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    out.push_str("--- ");
    out.push_str(old_label);
    out.push('\n');
    out.push_str("+++ ");
    out.push_str(new_label);
    out.push('\n');
    for hunk in &hunks {
        out.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            hunk.old_start, hunk.old_count, hunk.new_start, hunk.new_count
        ));
        for line in &hunk.lines {
            out.push(line.prefix);
            out.push_str(&line.text);
            out.push('\n');
            if line.no_newline {
                out.push_str("\\ No newline at end of file\n");
            }
        }
    }
    out
}

/// 按行切分，保留行尾换行符。
///
/// 保留换行符是为了区分「这一行以换行结尾」和「这是没有换行的最后一行」——
/// 前者不出标注，后者要标 `\ No newline at end of file`。
fn split_lines(s: &str) -> Vec<&str> {
    s.split_inclusive('\n').collect()
}

/// 计算行级差异序列。
fn diff_ops(old: &[&str], new: &[&str]) -> Vec<Op> {
    // 先剥离公共前后缀：AI 续写笔记时两边有大量相同内容，
    // 剥离后待比较的部分很小，动态规划才不会退化。
    let mut prefix = 0usize;
    while prefix < old.len() && prefix < new.len() && old[prefix] == new[prefix] {
        prefix += 1;
    }
    let mut suffix = 0usize;
    while suffix < old.len() - prefix
        && suffix < new.len() - prefix
        && old[old.len() - 1 - suffix] == new[new.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let old_mid = &old[prefix..old.len() - suffix];
    let new_mid = &new[prefix..new.len() - suffix];

    let mut ops: Vec<Op> = (0..prefix).map(|i| Op::Equal(i, i)).collect();
    ops.extend(lcs_ops(old_mid, new_mid, prefix));
    for k in 0..suffix {
        let old_idx = old.len() - suffix + k;
        let new_idx = new.len() - suffix + k;
        ops.push(Op::Equal(old_idx, new_idx));
    }
    ops
}

/// 在两段行序列上求 LCS，返回带绝对行号的差异序列。
///
/// `offset` 是这两段在各自文件里的起始行号。
fn lcs_ops(old: &[&str], new: &[&str], offset: usize) -> Vec<Op> {
    let n = old.len();
    let m = new.len();
    if n == 0 || m == 0 || n * m > MAX_LCS_CELLS {
        // 一侧为空或差异过大：整块删除 + 整块新增。
        let mut ops: Vec<Op> = (0..n).map(|i| Op::Delete(offset + i)).collect();
        ops.extend((0..m).map(|j| Op::Insert(offset + j)));
        return ops;
    }

    // dp[i * stride + j]：old[..i] 与 new[..j] 的最长公共子序列长度。
    let stride = m + 1;
    let mut dp = vec![0u32; (n + 1) * stride];
    for i in 0..n {
        for j in 0..m {
            dp[(i + 1) * stride + (j + 1)] = if old[i] == new[j] {
                dp[i * stride + j] + 1
            } else {
                dp[i * stride + (j + 1)].max(dp[(i + 1) * stride + j])
            };
        }
    }

    // 从尾部回溯，收集差异。
    let mut ops: Vec<Op> = Vec::new();
    let (mut i, mut j) = (n, m);
    while i > 0 && j > 0 {
        if old[i - 1] == new[j - 1] {
            ops.push(Op::Equal(offset + i - 1, offset + j - 1));
            i -= 1;
            j -= 1;
        } else if dp[(i - 1) * stride + j] >= dp[i * stride + (j - 1)] {
            ops.push(Op::Delete(offset + i - 1));
            i -= 1;
        } else {
            ops.push(Op::Insert(offset + j - 1));
            j -= 1;
        }
    }
    while i > 0 {
        ops.push(Op::Delete(offset + i - 1));
        i -= 1;
    }
    while j > 0 {
        ops.push(Op::Insert(offset + j - 1));
        j -= 1;
    }
    ops.reverse();
    // 同一处的「删除」排在「新增」前面，与 git 的输出习惯一致。
    normalize_order(&mut ops);
    ops
}

/// 把连续变更块里的删除行挪到新增行前面。
fn normalize_order(ops: &mut [Op]) {
    let mut i = 0usize;
    while i < ops.len() {
        if matches!(ops[i], Op::Equal(_, _)) {
            i += 1;
            continue;
        }
        let start = i;
        while i < ops.len() && !matches!(ops[i], Op::Equal(_, _)) {
            i += 1;
        }
        let mut merged: Vec<Op> = Vec::with_capacity(i - start);
        merged.extend(
            ops[start..i]
                .iter()
                .copied()
                .filter(|op| matches!(op, Op::Delete(_))),
        );
        merged.extend(
            ops[start..i]
                .iter()
                .copied()
                .filter(|op| matches!(op, Op::Insert(_))),
        );
        ops[start..i].copy_from_slice(&merged);
    }
}

/// 把差异序列切成若干 hunk（上下文 3 行）。
fn build_hunks(ops: &[Op], old: &[&str], new: &[&str]) -> Vec<Hunk> {
    // 每个 op 之前已经消费掉的旧行数与新行数（末尾多留一格，方便取 hi 处的累计值）。
    let mut old_pos = vec![0usize; ops.len() + 1];
    let mut new_pos = vec![0usize; ops.len() + 1];
    let (mut o, mut n) = (0usize, 0usize);
    for (k, op) in ops.iter().enumerate() {
        old_pos[k] = o;
        new_pos[k] = n;
        match op {
            Op::Equal(_, _) => {
                o += 1;
                n += 1;
            }
            Op::Delete(_) => o += 1,
            Op::Insert(_) => n += 1,
        }
    }
    old_pos[ops.len()] = o;
    new_pos[ops.len()] = n;

    // 变化位置分组：两个变化之间间隔的相同行 ≤ 2 * CONTEXT 时合并为一组。
    let changed: Vec<usize> = ops
        .iter()
        .enumerate()
        .filter(|(_, op)| !matches!(op, Op::Equal(_, _)))
        .map(|(i, _)| i)
        .collect();
    if changed.is_empty() {
        return Vec::new();
    }
    let mut groups: Vec<(usize, usize)> = Vec::new();
    let mut group_start = changed[0];
    let mut group_end = changed[0];
    for &c in &changed[1..] {
        let gap = c - group_end - 1;
        if gap <= 2 * CONTEXT {
            group_end = c;
        } else {
            groups.push((group_start, group_end));
            group_start = c;
            group_end = c;
        }
    }
    groups.push((group_start, group_end));

    let mut hunks = Vec::new();
    for (gs, ge) in groups {
        let lo = gs.saturating_sub(CONTEXT);
        let hi = (ge + CONTEXT + 1).min(ops.len());
        let old_start_idx = old_pos[lo];
        let new_start_idx = new_pos[lo];
        let old_count = old_pos[hi] - old_pos[lo];
        let new_count = new_pos[hi] - new_pos[lo];
        let mut lines = Vec::new();
        for op in &ops[lo..hi] {
            match op {
                Op::Equal(i, _) => lines.push(make_line(' ', old[*i])),
                Op::Delete(i) => lines.push(make_line('-', old[*i])),
                Op::Insert(j) => lines.push(make_line('+', new[*j])),
            }
        }
        hunks.push(Hunk {
            // 行数为 0 时，行号表示「插在这个位置之前」，与 git 一致。
            old_start: if old_count == 0 {
                old_start_idx
            } else {
                old_start_idx + 1
            },
            old_count,
            new_start: if new_count == 0 {
                new_start_idx
            } else {
                new_start_idx + 1
            },
            new_count,
            lines,
        });
    }
    hunks
}

/// 组装一行 diff 输出：去掉行尾换行符，单独记录「原本没有换行」。
fn make_line(prefix: char, raw: &str) -> DiffLine {
    let (text, no_newline) = match raw.strip_suffix('\n') {
        Some(t) => (t.to_string(), false),
        None => (raw.to_string(), true),
    };
    DiffLine {
        prefix,
        text,
        no_newline,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_新增文件输出全部新增行() {
        let d = unified_diff("", "第一行\n第二行\n", "/dev/null", "新文件.md");
        assert!(d.starts_with("--- /dev/null\n+++ 新文件.md\n"));
        assert!(d.contains("@@ -0,0 +1,2 @@"));
        assert!(d.contains("+第一行"));
        assert!(d.contains("+第二行"));
        assert!(!d.contains("-第一行"));
    }

    #[test]
    fn diff_修改文件输出上下文与增删() {
        let old = "第一行\n第二行\n第三行\n第四行\n第五行\n";
        let new = "第一行\n第二行\n改过的第三行\n第四行\n第五行\n";
        let d = unified_diff(old, new, "a.md", "a.md");
        assert!(d.starts_with("--- a.md\n+++ a.md\n"));
        assert!(d.contains("-第三行"));
        assert!(d.contains("+改过的第三行"));
        assert!(d.contains(" 第一行"));
        assert!(d.contains(" 第五行"));
        assert!(d.contains("@@ -1,5 +1,5 @@"));
    }

    #[test]
    fn diff_纯删除输出删除行() {
        let d = unified_diff("甲\n乙\n", "", "a.md", "/dev/null");
        assert!(d.contains("--- a.md\n+++ /dev/null\n"));
        assert!(d.contains("@@ -1,2 +0,0 @@"));
        assert!(d.contains("-甲"));
        assert!(d.contains("-乙"));
    }

    #[test]
    fn diff_无变化返回空串() {
        let same = "内容一样\n第二行\n";
        assert_eq!(unified_diff(same, same, "a.md", "a.md"), "");
    }

    #[test]
    fn diff_末行无换行时标注() {
        let d = unified_diff("甲\n", "甲\n乙", "a.md", "a.md");
        assert!(d.contains("+乙\n\\ No newline at end of file\n"));
    }

    #[test]
    fn diff_相距较远的两处改动分成两个块() {
        let mut old = String::new();
        let mut new = String::new();
        for i in 0..40 {
            old.push_str(&format!("第{i}行\n"));
            if i == 2 {
                new.push_str("改过的第2行\n");
            } else if i == 30 {
                new.push_str("改过的第30行\n");
            } else {
                new.push_str(&format!("第{i}行\n"));
            }
        }
        let d = unified_diff(&old, &new, "a.md", "a.md");
        assert_eq!(d.matches("@@ ").count(), 2, "应输出两个差异块，实际: {d}");
        assert!(d.contains("-第2行"));
        assert!(d.contains("+改过的第30行"));
    }

    #[test]
    fn diff_同一处的删除排在新增之前() {
        let d = unified_diff("甲\n", "乙\n", "a.md", "a.md");
        let del = d.find("-甲").unwrap();
        let ins = d.find("+乙").unwrap();
        assert!(del < ins, "删除行应排在新增行之前，实际: {d}");
    }
}
