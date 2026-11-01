//! 时间工具：UTC 日期换算与时间格式化。
//!
//! 放在 lib 里是因为 `guard.rs`（快照 ID 与 ISO 时间戳）也要用到公历换算，
//! 而 `guard.rs` 不能依赖 bin 侧的 `library.rs`——那会造成 lib ↔ bin 的循环依赖。

use std::time::{SystemTime, UNIX_EPOCH};

/// 从「自 1970-01-01 起的天数」反推公历日期（Howard Hinnant 算法）。
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 把 Unix 时间戳格式化为 `YYYY-MM-DD HH:MM`（UTC）。
///
/// 不引入 chrono 等依赖：只用于列表里展示修改时间，精度到分钟足够。
pub fn format_time(t: SystemTime) -> String {
    let secs = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}",
        rem / 3600,
        (rem % 3600) / 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `civil_from_days` 的逆运算，仅用于测试。
    fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
        let y = if m <= 2 { y - 1 } else { y };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let mp = if m > 2 { m - 3 } else { m + 9 } as i64;
        let doy = (153 * mp + 2) / 5 + d as i64 - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    }

    #[test]
    fn 纪元起点是_1970_01_01() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn 已知日期换算正确() {
        assert_eq!(civil_from_days(20758), (2026, 11, 1));
        assert_eq!(civil_from_days(19782), (2024, 2, 29));
    }

    #[test]
    fn 往返一致_覆盖十年间的日期() {
        // 逐日往返，确保算法在闰年、世纪边界上都不漂移
        let mut days = days_from_civil(2020, 1, 1);
        let end = days_from_civil(2030, 1, 1);
        while days < end {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(days_from_civil(y, m, d), days, "第 {days} 天往返失败");
            days += 1;
        }
    }

    #[test]
    fn 闰日被正确识别() {
        // 2024 是闰年，2023 不是
        assert_eq!(civil_from_days(days_from_civil(2024, 2, 29)), (2024, 2, 29));
        assert_eq!(civil_from_days(days_from_civil(2023, 2, 28)), (2023, 2, 28));
    }
}
