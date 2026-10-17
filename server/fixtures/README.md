# Mock fixtures

Files the n8n mock (`server/utils/n8n-mock.ts`) plays back when `NUXT_N8N_MODE=mock`.
They are read from this folder relative to the project root (the working directory of
`pnpm dev` and `pnpm preview`, and `/app` in the Docker image, which copies this folder).
Mock mode is only used in production for the first deployment (`N8N_MODE=mock`, change
`deploy-to-vps`); it is switched to `live` once the n8n workflows exist.

| File | Used for | Notes |
|---|---|---|
| `brand-dna.json` | `brand_extract` result | Must stay valid against `shared/schemas/brand-dna.ts` |
| `logo.png` | `brand_extract` logo | 256×256 |
| `post.json` | `post` result (caption, hashtags, image brief) | Must stay valid against the post payload contract |
| `post.png` | `post` image | 1080×1350 (4:5) |
| `video-script.json` | `video` script (progress + result) | Must stay valid against the video payload contract |
| `storyboard.png` | `video` storyboard | 810×960, 3×2 grid of 9:16 panels |
| `video.mp4` | `video` result | 360×640 (9:16), 10 s, H.264 + AAC, `moov` first |

A video fails in the mock when `mock:fail` appears anywhere in the request, which for a video
means the caption of the post (a prompt with that text already fails the post).

`pnpm test` checks that the JSON files conform to the contracts and that the binary files
have the right signature.

## Regenerating the binary files

The images use ImageMagick, the video uses ffmpeg. Any equivalent file works as long as it
keeps the format and size noted above.

```bash
FONT=/usr/share/fonts/noto/NotoSans-Bold.ttf   # any bold font

# logo.png
magick -size 256x256 xc:'#111111' -fill '#F97316' -draw 'circle 128,128 128,48' \
  -fill '#111111' -draw 'circle 150,110 150,70' -depth 8 -strip logo.png

# post.png
magick -size 1080x1350 xc:'#0A0A0A' -fill '#EA580C' -draw 'rectangle 0,1180 1080,1350' \
  -fill '#171717' -draw 'roundrectangle 90,300 990,1000 40,40' \
  -fill '#F97316' -draw 'circle 540,650 540,470' \
  -font "$FONT" -fill '#FAFAFA' -pointsize 96 -gravity north -annotate +0+120 'Mock post' \
  -pointsize 44 -fill '#A1A1AA' -gravity south -annotate +0+60 'fixture for mock mode' \
  -depth 8 -strip post.png

# storyboard.png (3 columns x 2 rows of 270x480 panels)
args=(); for row in 0 1; do for col in 0 1 2; do x=$((col*270)); y=$((row*480))
  args+=(-fill '#171717' -stroke '#3f3f46' -strokewidth 4
    -draw "rectangle $((x+6)),$((y+6)) $((x+264)),$((y+474))"
    -stroke none -fill '#F97316' -draw "circle $((x+135)),$((y+240)) $((x+135)),$((y+170))")
done; done
magick -size 810x960 xc:'#0A0A0A' "${args[@]}" -font "$FONT" -fill '#FAFAFA' -pointsize 64 \
  -gravity northwest -annotate +30+30 '1' -annotate +300+30 '2' -annotate +570+30 '3' \
  -annotate +30+510 '4' -annotate +300+510 '5' -annotate +570+510 '6' \
  -depth 8 -strip storyboard.png

# video.mp4 (+faststart puts the moov atom first, which Safari needs for Range/seek)
ffmpeg -y -f lavfi -i "testsrc2=size=360x640:rate=24:duration=10" \
  -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=10" -filter:a "volume=0.1" \
  -c:v libx264 -preset veryfast -crf 34 -pix_fmt yuv420p -profile:v main \
  -c:a aac -b:a 48k -movflags +faststart -shortest video.mp4
```
