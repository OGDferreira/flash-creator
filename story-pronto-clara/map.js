function fitText(context, text, maxWidth) {
  let fitted = String(text || '');
  while (fitted && context.measureText(fitted).width > maxWidth) {
    fitted = `${fitted.slice(0, -2)}…`;
  }
  return fitted;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawChainIcon(context, x, y, size) {
  context.save();
  context.translate(x, y);
  context.scale(size / 24, size / 24);
  context.lineWidth = 2.4;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const gradient = context.createLinearGradient(4, 20, 20, 4);
  gradient.addColorStop(0, '#feda75');
  gradient.addColorStop(0.36, '#fa7e1e');
  gradient.addColorStop(0.68, '#d62976');
  gradient.addColorStop(1, '#962fbf');
  context.strokeStyle = gradient;
  context.beginPath();
  context.moveTo(10, 13.8);
  context.lineTo(14, 9.8);
  context.stroke();
  context.beginPath();
  context.moveTo(8.5, 16.3);
  context.lineTo(6.8, 18);
  context.arc(5.1, 16.3, 2.4, Math.PI / 2, Math.PI * 1.5);
  context.lineTo(7.2, 11.8);
  context.arc(9.6, 11.8, 2.4, Math.PI, Math.PI * 1.5);
  context.stroke();
  context.beginPath();
  context.moveTo(15.5, 7.3);
  context.lineTo(17.2, 5.6);
  context.arc(18.9, 7.3, 2.4, -Math.PI / 2, Math.PI / 2);
  context.lineTo(16.8, 11.8);
  context.arc(14.4, 11.8, 2.4, 0, Math.PI / 2);
  context.stroke();
  context.restore();
}

/** Draw the editor's link button into the 9:16 image using normalized map data. */
export function drawLinkButton(context, link, layout, frameWidth = 1080, frameHeight = 1920) {
  if (!link?.url || !layout) return;

  const centerX = layout.x * frameWidth;
  const centerY = layout.y * frameHeight;
  const width = layout.width * frameWidth;
  const height = layout.height * frameHeight;
  const radius = Math.min(height / 2, width / 2);
  const padX = Math.min(width * 0.075, height * 0.46);
  const iconSize = Math.min(height * 0.48, width * 0.12);
  const gap = Math.min(height * 0.08, width * 0.035);
  const textWidth = Math.max(1, width - 2 * padX - iconSize - gap);
  const contentWidth = iconSize + gap + textWidth;
  const iconX = -contentWidth / 2;
  const textX = iconX + iconSize + gap;
  const titleFont = Math.min(height * 0.34, width * 0.062, 48);

  context.save();
  context.translate(centerX, centerY);
  context.rotate(layout.rotation || 0);
  roundRect(context, -width / 2, -height / 2, width, height, radius);
  context.fillStyle = '#ffffff';
  context.fill();
  context.strokeStyle = 'rgba(24, 31, 27, 0.2)';
  context.lineWidth = Math.max(2, height * 0.016);
  context.stroke();

  drawChainIcon(context, iconX, -iconSize / 2, iconSize);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#202523';
  context.font = `700 ${titleFont}px "Segoe UI", sans-serif`;
  const title = fitText(context, link.title || 'Acessar link', textWidth);
  context.fillText(title, textX + textWidth / 2, 0, textWidth);
  context.restore();
}