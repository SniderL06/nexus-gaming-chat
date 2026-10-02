"""
Genera todos los iconos PNG para la PWA de Nexus desde el SVG del favicon.
Usa Pillow + cairosvg si está disponible, o dibuja el ícono con Pillow puro como fallback.
"""
import os
import struct
import zlib
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "assets" / "icons"
SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
BG_COLOR = (13, 13, 26, 255)  # #0d0d1a

def try_cairosvg(svg_path, output_dir, sizes):
    """Intenta usar cairosvg para conversión fiel del SVG."""
    try:
        import cairosvg
        for size in sizes:
            out = output_dir / f"icon-{size}.png"
            cairosvg.svg2png(
                url=str(svg_path),
                write_to=str(out),
                output_width=size,
                output_height=size
            )
            print(f"  [OK] icon-{size}.png (cairosvg)")
        return True
    except ImportError:
        return False

def draw_nexus_icon_pillow(size):
    """Dibuja el ícono Nexus directamente con Pillow (sin SVG)."""
    from PIL import Image, ImageDraw
    
    img = Image.new("RGBA", (size, size), BG_COLOR)
    draw = ImageDraw.Draw(img)
    
    # Escalar coordenadas al tamaño deseado (base 100x100)
    def s(v):
        return int(v * size / 100)
    
    # Nodos
    nodes = [(22, 22), (78, 22), (22, 78), (78, 78), (50, 50)]
    
    # Líneas de conexión
    edges = [
        ((22, 78), (22, 22)),
        ((22, 22), (78, 78)),
        ((78, 78), (78, 22)),
        ((22, 22), (50, 50)),
        ((50, 50), (78, 22)),
        ((22, 78), (50, 50)),
        ((50, 50), (78, 78)),
    ]
    
    lw = max(1, size // 25)
    
    for (x1, y1), (x2, y2) in edges:
        draw.line([(s(x1), s(y1)), (s(x2), s(y2))], fill=(0, 212, 255, 200), width=lw)
    
    # Nodos circulares
    node_r = max(2, size // 11)
    colors = [
        (0, 212, 255, 255),   # 22,22 cyan
        (168, 85, 247, 255),  # 78,22 purple  
        (0, 212, 255, 255),   # 22,78 cyan
        (168, 85, 247, 255),  # 78,78 purple
        (192, 132, 252, 255), # 50,50 light purple
    ]
    node_radii = [node_r, node_r, node_r, node_r, max(2, size // 14)]
    
    for i, (nx, ny) in enumerate(nodes):
        cx, cy = s(nx), s(ny)
        r = node_radii[i]
        draw.ellipse([(cx - r, cy - r), (cx + r, cy + r)], fill=colors[i])
    
    return img

def make_icons_pillow(output_dir, sizes):
    from PIL import Image
    for size in sizes:
        icon = draw_nexus_icon_pillow(size)
        # Fondo redondeado
        mask = Image.new("L", (size, size), 0)
        from PIL import ImageDraw
        md = ImageDraw.Draw(mask)
        radius = int(size * 0.22)
        md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        
        bg = Image.new("RGBA", (size, size), BG_COLOR)
        bg.paste(icon, mask=mask)
        
        out = output_dir / f"icon-{size}.png"
        bg.save(str(out), "PNG")
        print(f"  [OK] icon-{size}.png (pillow)")

if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    svg_path = Path(__file__).parent.parent / "assets" / "nexus_favicon.svg"
    
    print(f"Generando {len(SIZES)} iconos PNG para la PWA de Nexus...")
    print(f"Destino: {OUTPUT_DIR}\n")
    
    if not try_cairosvg(svg_path, OUTPUT_DIR, SIZES):
        print("cairosvg no disponible - usando Pillow puro...")
        make_icons_pillow(OUTPUT_DIR, SIZES)
    
    print(f"\nIconos generados correctamente en assets/icons/")
    print("   Haz commit y push de la carpeta.")

