import sys
from PIL import Image

def process_icon():
    source_path = 'source-icon.png'
    output_path = 'icon.png'
    
    try:
        # 打開原始圖片
        img = Image.open(source_path).convert('RGB')
        
        # 取得左上角的像素顏色作為背景擴展的底色
        bg_color = img.getpixel((0, 0))
        
        # Expo 規範：1024x1024
        target_size = 1024
        # 安全區域：內容需在 66% 內 (1024 * 0.66 ≈ 675)，我們設定 680
        content_size = 680
        
        # 建立一個新的空白畫布，填滿背景色
        new_img = Image.new('RGB', (target_size, target_size), bg_color)
        
        # 調整原圖大小為內容安全尺寸 (這裡我們使用 LANCZOS 以獲得最高品質)
        resized_img = img.resize((content_size, content_size), Image.Resampling.LANCZOS)
        
        # 計算置中的座標
        offset = ((target_size - content_size) // 2, (target_size - content_size) // 2)
        
        # 將縮小的圖貼到畫布正中央
        new_img.paste(resized_img, offset)
        
        # 儲存為 icon.png
        new_img.save(output_path, 'PNG')
        print(f"Success! Saved padded icon to {output_path} with bg_color {bg_color}")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)

if __name__ == '__main__':
    process_icon()
