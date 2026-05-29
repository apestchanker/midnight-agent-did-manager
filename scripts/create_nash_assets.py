from pathlib import Path
import textwrap

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "build" / "personas"
OUT.mkdir(parents=True, exist_ok=True)


def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


F = {
    "title": font(58, True),
    "subtitle": font(28),
    "h1": font(34, True),
    "h2": font(26, True),
    "body": font(24),
    "small": font(20),
    "tiny": font(18),
    "tag": font(19, True),
}

COL = {
    "ink": "#1F2933",
    "muted": "#52606D",
    "line": "#D7DEE8",
    "bg": "#F7F9FC",
    "paper": "#FFFFFF",
    "green": "#2F7D63",
    "teal": "#0E7490",
    "blue": "#345995",
    "red": "#B5473F",
    "amber": "#B7791F",
    "purple": "#6D5BD0",
    "lime": "#7C8A2E",
    "sticky_yellow": "#FFF0A8",
    "sticky_blue": "#D8ECFF",
    "sticky_green": "#DFF5D6",
    "sticky_pink": "#FFE1E8",
    "sticky_lav": "#E9E2FF",
}


def rounded(draw, xy, r=18, fill="#FFFFFF", outline="#D7DEE8", width=2):
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)


def text(draw, xy, content, fnt=None, fill=None, anchor=None):
    draw.text(xy, content, font=fnt or F["body"], fill=fill or COL["ink"], anchor=anchor)


def wrapped(draw, x, y, content, max_width, fnt=None, fill=None, line_gap=7, max_lines=None):
    fnt = fnt or F["body"]
    fill = fill or COL["ink"]
    words = content.split()
    lines = []
    current = ""
    for word in words:
        test = word if not current else f"{current} {word}"
        if draw.textbbox((0, 0), test, font=fnt)[2] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        while lines[-1] and draw.textbbox((0, 0), lines[-1] + "...", font=fnt)[2] > max_width:
            lines[-1] = lines[-1].rsplit(" ", 1)[0] if " " in lines[-1] else lines[-1][:-1]
        lines[-1] += "..."
    for line in lines:
        draw.text((x, y), line, font=fnt, fill=fill)
        y += fnt.size + line_gap
    return y


def bullet_list(draw, x, y, items, max_width, fnt=None, fill=None, gap=13, bullet_fill=None, max_lines_each=None):
    fnt = fnt or F["small"]
    fill = fill or COL["ink"]
    bullet_fill = bullet_fill or fill
    for item in items:
        draw.ellipse((x, y + 8, x + 9, y + 17), fill=bullet_fill)
        y = wrapped(draw, x + 24, y, item, max_width - 24, fnt, fill, line_gap=5, max_lines=max_lines_each)
        y += gap
    return y


def card(draw, x, y, w, h, title, accent, body=None):
    rounded(draw, (x, y, x + w, y + h), r=22, fill=COL["paper"], outline=COL["line"], width=2)
    draw.rounded_rectangle((x, y, x + 14, y + h), radius=8, fill=accent)
    text(draw, (x + 34, y + 26), title, F["h2"], COL["ink"])
    if body:
        return wrapped(draw, x + 34, y + 72, body, w - 68, F["small"], COL["muted"], line_gap=6)
    return y + 72


def tag(draw, x, y, label, fill):
    pad_x = 16
    pad_y = 8
    bbox = draw.textbbox((0, 0), label, font=F["tag"])
    w = bbox[2] - bbox[0] + pad_x * 2
    h = bbox[3] - bbox[1] + pad_y * 2
    draw.rounded_rectangle((x, y, x + w, y + h), radius=16, fill=fill)
    text(draw, (x + pad_x, y + pad_y - 1), label, F["tag"], "#FFFFFF")
    return x + w + 12


def make_persona():
    W, H = 1700, 2380
    img = Image.new("RGB", (W, H), COL["bg"])
    d = ImageDraw.Draw(img)

    d.rectangle((0, 0, W, 305), fill="#14213D")
    d.rectangle((0, 276, W, 305), fill="#2F7D63")
    text(d, (80, 58), "NASH", F["title"], "#FFFFFF")
    text(d, (80, 132), "Builder Persona: Agentic Automation Trust", F["subtitle"], "#E6EEF8")
    wrapped(
        d,
        80,
        184,
        "A Portugal-based builder using AI agents to create, test, and implement code for a privacy-preserving proof platform.",
        1000,
        F["body"],
        "#E6EEF8",
        line_gap=8,
    )
    x = 1120
    for label, color in [
        ("Portugal", COL["green"]),
        ("Digital nomad", COL["teal"]),
        ("AI agents", COL["purple"]),
        ("Proof builder", COL["amber"]),
    ]:
        x = tag(d, x, 72 if x == 1120 else 125, label, color) if x > 1540 else tag(d, x, 72, label, color)

    # Persona portrait
    rounded(d, (80, 360, 475, 920), r=28, fill="#F1F5F9", outline=COL["line"], width=2)
    d.ellipse((150, 398, 405, 653), fill="#DCEBFF", outline="#AFC7E8", width=3)
    d.ellipse((198, 440, 357, 599), fill="#C98F65", outline="#8D5C3B", width=3)
    d.pieslice((190, 415, 365, 545), 180, 360, fill="#2B2F3A")
    d.rounded_rectangle((176, 586, 380, 820), radius=58, fill="#2F7D63", outline="#24634E", width=3)
    d.polygon([(176, 630), (278, 715), (380, 630), (380, 820), (176, 820)], fill="#345995")
    d.rectangle((244, 600, 312, 654), fill="#C98F65")
    d.line((228, 530, 248, 522), fill="#1F2933", width=4)
    d.line((306, 522, 326, 530), fill="#1F2933", width=4)
    d.ellipse((238, 535, 248, 545), fill="#1F2933")
    d.ellipse((316, 535, 326, 545), fill="#1F2933")
    d.arc((240, 540, 326, 582), 20, 160, fill="#7A4F34", width=3)
    d.rounded_rectangle((185, 765, 372, 820), radius=12, fill="#16213B")
    text(d, (278, 784), "agent builder", F["tiny"], "#FFFFFF", anchor="mm")
    text(d, (278, 885), "Hypothesis-backed profile", F["small"], COL["muted"], anchor="mm")

    y = card(d, 520, 360, 1100, 315, "Snapshot", COL["blue"])
    snapshot = [
        ("Location", "Portugal, mobile across EU builder communities"),
        ("Age", "Early-to-mid 30s"),
        ("Language", "Speaks English well; comfortable in global dev channels"),
        ("Work", "Formal job pays the bills; side project explores agent automation"),
        ("Background", "3 years building with AI; some blockchain experience"),
        ("Ecosystem", "Joined Midnight last year; tests tech through hackathons"),
    ]
    cx, cy = 554, 432
    for i, (k, v) in enumerate(snapshot):
        col = i % 2
        row = i // 2
        tx = cx + col * 520
        ty = cy + row * 78
        text(d, (tx, ty), k.upper(), F["tiny"], COL["muted"])
        wrapped(d, tx, ty + 23, v, 450, F["small"], COL["ink"], line_gap=4, max_lines=2)

    y = card(d, 520, 710, 1100, 270, "Mindset", COL["green"])
    bullet_list(
        d,
        554,
        y,
        [
            "Pragmatic builder: trusts tools that remove friction without hiding risk.",
            "Values composability, inspectable primitives, clean docs, and credible security language.",
            "Wants agent autonomy, but needs confidence that actions are authorized and bounded.",
            "Prefers developer workflows over enterprise compliance theater.",
        ],
        1015,
        F["small"],
        COL["ink"],
        bullet_fill=COL["green"],
    )

    left_x, right_x = 80, 870
    y1 = card(d, left_x, 1025, 730, 355, "Jobs To Be Done", COL["teal"])
    bullet_list(
        d,
        left_x + 34,
        y1,
        [
            "Use agents to generate, test, and implement code faster.",
            "Let agents interact with repos, tools, wallets, APIs, and shared systems.",
            "Prove what an agent is allowed to do without exposing every internal policy.",
            "Retire, revoke, or update agent authority when work changes.",
        ],
        660,
        F["small"],
        bullet_fill=COL["teal"],
    )

    y2 = card(d, right_x, 1025, 750, 355, "Current Workarounds", COL["amber"])
    bullet_list(
        d,
        right_x + 34,
        y2,
        [
            "API keys, OAuth apps, service accounts, wallet permissions, logs, and manual reviews.",
            "Human-readable naming conventions to remember which agent can do what.",
            "Ad hoc approval flows when agents touch external or sensitive systems.",
            "Custom policy documents that are hard for third parties to verify.",
        ],
        680,
        F["small"],
        bullet_fill=COL["amber"],
    )

    y3 = card(d, left_x, 1390, 730, 395, "Pains", COL["red"])
    bullet_list(
        d,
        left_x + 34,
        y3,
        [
            "External systems cannot easily verify the agent's current identity and mandate.",
            "Authorization status gets unclear after key leakage, expired tasks, or agent retirement.",
            "Capabilities and limits are too coarse: all-or-nothing keys create avoidable risk.",
            "Audits are fragmented across logs, tools, accounts, and local assumptions.",
        ],
        660,
        F["small"],
        bullet_fill=COL["red"],
    )

    y4 = card(d, right_x, 1390, 750, 395, "Gains", COL["lime"])
    bullet_list(
        d,
        right_x + 34,
        y4,
        [
            "Portable Agent Pass: identity plus mandate, limits, capabilities, and auth level.",
            "Fast integration path for builders, ideally through APIs, SDKs, MCP, and examples.",
            "Selective proof of authority without revealing full private policy data.",
            "A credible open-source primitive that can later become hosted infrastructure.",
        ],
        680,
        F["small"],
        bullet_fill=COL["lime"],
    )

    y5 = card(d, 80, 1840, 1540, 365, "First Survey Signals + Hypotheses", COL["purple"])
    columns = [
        (
            "Survey signals",
            [
                "3 of 4 respondents have built or reviewed agent prototypes.",
                "2 of 4 already involve external or shared-system interaction.",
                "3 of 4 spent engineering/security time on trust, access, or review.",
                "4 of 4 are open or maybe open to follow-up interviews.",
            ],
        ),
        (
            "What this suggests",
            [
                "The strongest pain is not agent identity alone; it is proof of current authority.",
                "Builders need mandate, capability, limits, revocation, and auditability in one pattern.",
                "Early buyers/users are likely platform builders and ecosystem developers shipping real integrations.",
                "NASH is a high-signal early adopter if the product is simple, inspectable, and useful before enterprise scale.",
            ],
        ),
    ]
    for c, (heading, items) in enumerate(columns):
        px = 124 + c * 760
        text(d, (px, y5), heading, F["h2"], COL["ink"])
        bullet_list(d, px, y5 + 48, items, 695, F["small"], COL["ink"], gap=10, bullet_fill=COL["purple"], max_lines_each=2)

    d.rectangle((0, H - 92, W, H), fill="#14213D")
    wrapped(
        d,
        80,
        H - 70,
        "Positioning implication: sell the Agent Pass / MultiPass as a verifiable authority layer for autonomous agents. Midnight remains the privacy-preserving substrate, not the user-facing pitch.",
        1500,
        F["small"],
        "#E6EEF8",
        line_gap=5,
    )
    img.save(OUT / "nash-builder-persona.png")


def sticky(draw, x, y, w, h, title, body, fill):
    draw.rounded_rectangle((x + 8, y + 10, x + w + 8, y + h + 10), radius=10, fill="#CCD4DF")
    draw.rounded_rectangle((x, y, x + w, y + h), radius=10, fill=fill, outline="#D2B75E", width=1)
    text(draw, (x + 22, y + 18), title, F["tag"], COL["ink"])
    wrapped(draw, x + 22, y + 52, body, w - 44, F["tiny"], COL["ink"], line_gap=4, max_lines=4)


def panel(draw, x, y, w, h, title, fill):
    draw.rounded_rectangle((x, y, x + w, y + h), radius=28, fill=fill, outline=COL["line"], width=2)
    text(draw, (x + 34, y + 28), title, F["h1"], COL["ink"])
    return y + 92


def connector(draw, start, end, color, label=None):
    draw.line((start, end), fill=color, width=3)
    sx, sy = start
    ex, ey = end
    mx, my = (sx + ex) / 2, (sy + ey) / 2
    draw.polygon([(ex, ey), (ex - 14, ey - 8), (ex - 12, ey + 10)], fill=color)


def make_vpc():
    W, H = 2600, 1550
    img = Image.new("RGB", (W, H), "#F6F8FB")
    d = ImageDraw.Draw(img)

    d.rectangle((0, 0, W, 150), fill="#14213D")
    text(d, (70, 38), "Value Proposition Canvas", F["title"], "#FFFFFF")
    text(d, (70, 103), "NASH x Agent Pass / MultiPass, classic template layout with fit lines", F["subtitle"], "#E6EEF8")

    sx, sy, side = 70, 205, 1100
    center = (sx + side / 2, sy + side / 2)
    cx, cy, cr = 1835, 755, 550

    # Outer template shapes.
    d.rectangle((sx, sy, sx + side, sy + side), fill="#FFFFFF", outline="#222222", width=7)
    d.ellipse((cx - cr, cy - cr, cx + cr, cy + cr), fill="#FFFFFF", outline="#222222", width=7)

    # Value Map diagonals to the gift/value icon in center.
    for point in [(sx, sy), (sx + side, sy), (sx, sy + side), (sx + side, sy + side)]:
        d.line((point, center), fill="#222222", width=4)

    # Customer Profile radial dividers.
    d.line((cx, cy, cx + 390, cy - 390), fill="#222222", width=4)
    d.line((cx, cy, cx + 390, cy + 390), fill="#222222", width=4)
    d.line((cx - cr, cy, cx, cy), fill="#222222", width=4)

    # Section labels.
    text(d, (sx + 150, sy + 500), "Products\n& Services", F["h2"], COL["ink"], anchor="mm")
    text(d, (sx + 620, sy + 230), "Gain Creators", F["h2"], COL["ink"], anchor="mm")
    text(d, (sx + 635, sy + 780), "Pain Relievers", F["h2"], COL["ink"], anchor="mm")
    text(d, (cx + 330, cy - 20), "Customer\nJob(s)", F["h2"], COL["ink"], anchor="mm")
    text(d, (cx - 170, cy - 300), "Gains", F["h2"], COL["ink"], anchor="mm")
    text(d, (cx - 170, cy + 255), "Pains", F["h2"], COL["ink"], anchor="mm")

    # Simple template icons.
    d.rectangle((sx + 130, sy + 595, sx + 230, sy + 660), fill="#111111")
    for i in range(7):
        d.line((sx + 142 + i * 12, sy + 598, sx + 142 + i * 12, sy + 655), fill="#FFFFFF", width=3)
    d.pieslice((sx + 215, sy + 620, sx + 285, sy + 690), 180, 360, fill="#111111")
    d.rectangle((sx + 185, sy + 655, sx + 285, sy + 690), fill="#111111")
    d.rectangle((sx + 480, sy + 545, sx + 660, sy + 670), outline="#111111", width=7)
    d.line((sx + 570, sy + 545, sx + 570, sy + 670), fill="#111111", width=7)
    d.line((sx + 480, sy + 585, sx + 660, sy + 585), fill="#111111", width=7)
    d.ellipse((sx + 525, sy + 500, sx + 570, sy + 545), outline="#111111", width=7)
    d.ellipse((sx + 570, sy + 500, sx + 615, sy + 545), outline="#111111", width=7)
    d.arc((sx + 725, sy + 300, sx + 835, sy + 410), 185, 270, fill="#111111", width=8)
    d.line((sx + 785, sy + 410, sx + 865, sy + 410), fill="#111111", width=8)
    d.polygon([(sx + 855, sy + 330), (sx + 880, sy + 305), (sx + 875, sy + 340)], fill="#111111")
    d.rounded_rectangle((sx + 725, sy + 840, sx + 775, sy + 930), radius=24, fill="#111111")

    d.ellipse((cx - 75, cy - 80, cx + 75, cy + 80), outline="#111111", width=7)
    d.polygon([(cx - 75, cy + 5), (cx - 115, cy + 30), (cx - 75, cy + 55)], fill="#FFFFFF", outline="#111111")
    d.ellipse((cx - 42, cy - 25, cx - 25, cy - 8), fill="#111111")
    d.line((cx + 300, cy - 55, cx + 360, cy - 55), fill="#111111", width=8)
    d.line((cx + 300, cy, cx + 360, cy), fill="#111111", width=8)
    d.line((cx + 300, cy + 55, cx + 360, cy + 55), fill="#111111", width=8)
    d.line((cx + 275, cy - 55, cx + 290, cy - 70), fill="#111111", width=7)
    d.line((cx + 290, cy - 70, cx + 300, cy - 40), fill="#111111", width=7)

    # Curved fit lines, rendered below post-its. Product/services and jobs stick to the edges.
    def curve(points, color):
        d.line(points, fill=color, width=3, joint="curve")
        ex, ey = points[-1]
        px, py = points[-2]
        ah = 14 if ex >= px else -14
        d.polygon([(ex, ey), (ex - ah, ey - 9), (ex - ah, ey + 9)], fill=color)

    orange = "#F97316"
    curve([(sx + 270, sy + 115), (sx + 760, sy + 80), (cx - 250, cy - 430)], orange)
    curve([(sx + 890, sy + 115), (sx + 1120, sy + 105), (cx - 60, cy - 455)], orange)
    curve([(sx + 790, sy + 355), (sx + 1005, sy + 390), (cx - 260, cy - 165)], orange)
    curve([(sx + 820, sy + 520), (sx + 1105, sy + 580), (cx - 305, cy + 15)], orange)
    curve([(sx + 820, sy + 715), (sx + 1070, sy + 820), (cx - 310, cy + 225)], orange)
    curve([(sx + 850, sy + 940), (sx + 1175, sy + 990), (cx - 300, cy + 430)], orange)

    # Product/service post-its stuck left.
    sticky(d, sx + 95, sy + 80, 285, 104, "Agent Pass", "Credential bundle for identity and live mandate.", COL["sticky_blue"])
    sticky(d, sx + 95, sy + 210, 285, 104, "Developer layer", "SDK/API/MCP onboarding and verifier patterns.", COL["sticky_blue"])
    sticky(d, sx + 95, sy + 340, 285, 104, "Open ref", "Inspectable OSS primitive.", COL["sticky_blue"])

    # Value Map gains and pain relievers.
    sticky(d, sx + 520, sy + 85, 285, 104, "Selective proof", "Show only claims a verifier needs.", COL["sticky_lav"])
    sticky(d, sx + 820, sy + 105, 235, 104, "Ecosystem fit", "Useful before enterprise scale.", COL["sticky_lav"])
    sticky(d, sx + 615, sy + 365, 285, 104, "Hosted path", "Managed issuance, verification, status, and policy UX.", COL["sticky_lav"])
    sticky(d, sx + 315, sy + 745, 285, 104, "Mandate proof", "Bind actions to user-approved mandates.", COL["sticky_yellow"])
    sticky(d, sx + 135, sy + 905, 285, 104, "Revocation", "Status checks for expired or compromised agents.", COL["sticky_yellow"])
    sticky(d, sx + 615, sy + 770, 285, 104, "Scoped authority", "Limits, capabilities, and auth levels.", COL["sticky_yellow"])
    sticky(d, sx + 740, sy + 955, 285, 104, "Audit trail", "Cleaner evidence for reviews and incidents.", COL["sticky_yellow"])

    # Customer jobs stuck right.
    sticky(d, cx + 235, cy - 360, 285, 104, "Build faster", "Use agents to create, test, and implement code.", COL["sticky_blue"])
    sticky(d, cx + 235, cy - 210, 285, 104, "Delegate safely", "Let agents operate without blind trust.", COL["sticky_blue"])
    sticky(d, cx + 235, cy - 60, 285, 104, "Explain authority", "Show what an agent can do and under what limits.", COL["sticky_blue"])

    # Customer gains and pains.
    sticky(d, cx - 325, cy - 410, 285, 104, "Credible proof", "Check identity, authority, status, and limits.", COL["sticky_green"])
    sticky(d, cx - 70, cy - 255, 285, 104, "Privacy", "Prove enough without exposing full policy.", COL["sticky_green"])
    sticky(d, cx - 360, cy - 110, 285, 104, "Fast integration", "Works through APIs, SDKs, MCP, and examples.", COL["sticky_green"])
    sticky(d, cx - 315, cy + 115, 285, 104, "Unclear mandate", "No portable way to prove active mandate.", COL["sticky_pink"])
    sticky(d, cx - 80, cy + 260, 285, 104, "Coarse keys", "Keys are weak at expressing limits.", COL["sticky_pink"])
    sticky(d, cx - 340, cy + 410, 285, 104, "Revocation gaps", "Leaked, expired, or retired agents leave uncertainty.", COL["sticky_pink"])

    d.rounded_rectangle((70, 1340, 2530, 1460), radius=22, fill="#14213D")
    wrapped(
        d,
        105,
        1372,
        "Core proposition: MultiPass gives autonomous agents a portable, privacy-preserving pass proving identity, current mandate, limits, capabilities, authorization level, and revocation status.",
        2350,
        F["small"],
        "#FFFFFF",
        line_gap=7,
    )
    img.save(OUT / "nash-value-proposition-canvas.png")


if __name__ == "__main__":
    make_persona()
    make_vpc()
