# Maintainer: 果农
pkgname=flymd
pkgver=$(bash "$startdir/scripts/get-version.sh" "$startdir/package.json" 2>/dev/null || echo "1.3.9")
pkgrel=1
pkgdesc="飞速 Markdown 编辑器 - 轻量高性能本地 Markdown 编辑器"
arch=('x86_64')
url="https://github.com/flyhunterl/flymd"
license=('custom')
depends=('webkit2gtk-4.1' 'gtk3' 'openssl' 'hicolor-icon-theme')
install=flymd.install
source=(
  "flymd.desktop"
)
sha256sums=('SKIP')

# 本地打包：直接安装已编译好的二进制
# 如需从源码构建，参考 PKGBUILD.source

package() {
  # Install binary (从项目已编译的 release 中获取)
  install -Dm755 "$startdir/src-tauri/target/release/flymd" "$pkgdir/usr/bin/flymd"

  # Install icon
  install -Dm644 "$startdir/Flymdnew.png" "$pkgdir/usr/share/pixmaps/flymd.png"
  for size in 32 128 256 512; do
    if [ -f "$startdir/src-tauri/icons/${size}x${size}.png" ]; then
      install -Dm644 "$startdir/src-tauri/icons/${size}x${size}.png" \
        "$pkgdir/usr/share/icons/hicolor/${size}x${size}/apps/flymd.png"
    fi
  done

  # Install desktop entry
  install -Dm644 "$srcdir/flymd.desktop" "$pkgdir/usr/share/applications/flymd.desktop"

  # Install license
  install -Dm644 "$startdir/LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE" 2>/dev/null || true
}
