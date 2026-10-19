"""Draw the MyDTC checklist mark used for the icon and the launch screen."""

from PIL import Image, ImageDraw

SIZE = 1024
GROUND = (22, 18, 28, 255)
BEZEL = (42, 35, 64, 255)
LINE = (205, 182, 255, 255)
CARD = (36, 28, 50, 255)
GREEN = (61, 220, 151, 255)
OPEN = (231, 220, 248, 255)
QUIET = (110, 90, 138, 255)
INK = (16, 42, 67, 255)


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def check(draw, x, y, size, color, weight):
    draw.line((x, y + size * 0.55, x + size * 0.35, y + size), fill=color, width=weight)
    draw.line((x + size * 0.35, y + size, x + size, y), fill=color, width=weight)


def main():
    image = Image.new("RGBA", (SIZE, SIZE), GROUND)
    draw = ImageDraw.Draw(image)
    rounded(draw, (96, 96, 928, 928), 180, BEZEL, LINE, 18)
    rounded(draw, (180, 230, 620, 794), 48, CARD)
    rows = (290, 470, 650)
    for index, top in enumerate(rows):
        box = (230, top, 310, top + 80)
        if index < 2:
            rounded(draw, box, 16, GREEN)
            check(draw, 246, top + 18, 48, INK, 10)
        else:
            rounded(draw, box, 16, OPEN, QUIET, 6)
        draw.rounded_rectangle((340, top + 30, 560, top + 48), radius=8, fill=LINE)
    check(draw, 680, 560, 70, QUIET, 14)
    check(draw, 700, 430, 100, LINE, 18)
    check(draw, 720, 270, 140, GREEN, 22)
    image.save("assets/mydtc-logo.png", "PNG")


if __name__ == "__main__":
    main()
