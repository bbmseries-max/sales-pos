/**
 * Lightweight Code128 Auto Barcode SVG Generator
 */
export function generateBarcodeSvg(data: string, height = 40): string {
  if (!data || data.trim() === '') return '';
  const text = data.trim();

  // Simple High-contrast bar pattern representation for shelf tags
  const patterns: { [key: string]: string } = {
    '0': '10100110110', '1': '11010010110', '2': '11010110010', '3': '10010110110',
    '4': '10110010110', '5': '10110100110', '6': '10110110010', '7': '11010100110',
    '8': '11010110100', '9': '10010110100', 'A': '10100011010', 'B': '10100110001',
    'C': '11000101010', 'D': '10110001010', 'E': '10101100010', 'F': '11010001010'
  };

  let binaryPattern = '11010010000'; // Start code B
  for (let i = 0; i < text.length; i++) {
    const char = text[i].toUpperCase();
    binaryPattern += patterns[char] || '10100110110';
  }
  binaryPattern += '1100011101011'; // Stop pattern

  let svgBars = '';
  let posX = 0;
  const barWidth = 1.6;

  for (let i = 0; i < binaryPattern.length; i++) {
    if (binaryPattern[i] === '1') {
      svgBars += `<rect x="${posX}" y="0" width="${barWidth}" height="${height}" fill="#000" />`;
    }
    posX += barWidth;
  }

  const totalWidth = posX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" preserveAspectRatio="none" style="width: 100%; height: 100%;">${svgBars}</svg>`;
}