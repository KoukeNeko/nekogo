import sys
import math
from PIL import Image

def process_icon():
    source_path = '/Users/doeshing/Documents/GitHub/Nekogo/apps/nekogo/src/assets/images/source-icon.png'
    output_path = '/Users/doeshing/Documents/GitHub/Nekogo/apps/nekogo/assets/images/icon.png'
    fg_output_path = '/Users/doeshing/Documents/GitHub/Nekogo/apps/nekogo/assets/images/android-icon-foreground.png'
    
    try:
        img = Image.open(source_path).convert('RGBA')
        width, height = img.size
        cx, cy = width / 2, height / 2
        
        bg_color_rgb = (21, 24, 29)
        bg_color_rgba = (21, 24, 29, 255)
        
        pixels = img.load()
        
        # 我們要把距離中心點較遠（大於 width * 0.35）的所有「白色/灰色」線條跟角落殘留都清除
        # 但要避開橘色的貓咪線條
        safe_radius = width * 0.35
        
        for y in range(height):
            for x in range(width):
                dist = math.hypot(x - cx, y - cy)
                
                # 如果在這個安全半徑之外 (代表是邊緣的四條白線，或是四個角落的白底)
                if dist > safe_radius:
                    r, g, b, a = pixels[x, y]
                    # 偵測是否為白色或灰色系（r, g, b 數值接近且大於深色背景）
                    if r > 40 and g > 40 and b > 40:
                        if abs(r - g) < 40 and abs(g - b) < 40:
                            # 是白色/灰色雜訊，將其替換為深色背景
                            pixels[x, y] = bg_color_rgba

        img = img.convert('RGB')
        
        target_size = 1024
        content_size = 680
        
        new_img = Image.new('RGB', (target_size, target_size), bg_color_rgb)
        resized_img = img.resize((content_size, content_size), Image.Resampling.LANCZOS)
        
        offset = ((target_size - content_size) // 2, (target_size - content_size) // 2)
        new_img.paste(resized_img, offset)
        
        new_img.save(output_path, 'PNG')
        new_img.save(fg_output_path, 'PNG')
        print("Success! Removed white lines and corners.")
            
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)

if __name__ == '__main__':
    process_icon()
