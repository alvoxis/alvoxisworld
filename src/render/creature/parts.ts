/**
 * Modular creature parts for procedural generation.
 * Each race composes body, head, limbs and details from these primitives.
 */
export interface Part {
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string): void;
}

export function bodyPart(width: number, height: number, round = 4): Part {
  return {
    draw(ctx, x, y, scale, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x - width * scale / 2, y - height * scale / 2, width * scale, height * scale, round * scale);
      ctx.fill();
    },
  };
}

export function headPart(radiusX: number, radiusY: number): Part {
  return {
    draw(ctx, x, y, scale, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, radiusX * scale, radiusY * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    },
  };
}

export function earPart(length: number, pointed = true): Part {
  return {
    draw(ctx, x, y, scale, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      if (pointed) {
        ctx.moveTo(x, y);
        ctx.lineTo(x - 2 * scale, y - length * scale);
        ctx.lineTo(x + 3 * scale, y);
      } else {
        ctx.ellipse(x, y - length * scale / 2, 2 * scale, length * scale / 2, 0, 0, Math.PI * 2);
      }
      ctx.fill();
    },
  };
}

export function beardPart(length: number): Part {
  return {
    draw(ctx, x, y, scale, _color) {
      ctx.fillStyle = '#3a2010';
      ctx.beginPath();
      ctx.moveTo(x - 4 * scale, y);
      ctx.quadraticCurveTo(x + 8 * scale, y + length * scale * 0.6, x, y + length * scale);
      ctx.quadraticCurveTo(x + 6 * scale, y + length * scale * 0.8, x + 5 * scale, y + 2 * scale);
      ctx.fill();
    },
  };
}

export function tuskPart(): Part {
  return {
    draw(ctx, x, y, scale, _color) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(x, y, 2 * scale, 5 * scale, scale);
      ctx.fill();
    },
  };
}
