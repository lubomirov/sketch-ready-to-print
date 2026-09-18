export function computeHistogram(mat) {
    if (!mat || mat.isDeleted()) throw new Error('Histogram input is empty or deleted');

    const isColor = mat.channels() >= 3;
    const channels = isColor ? 3 : 1;
    const hist = Array.from({ length: channels }, () => new Array(256).fill(0));
    const data = mat.depth() === cv.CV_32F || mat.depth() === cv.CV_64F ? mat.data32F : mat.data;
    const scale = mat.depth() === cv.CV_32F || mat.depth() === cv.CV_64F ? 255 : 1;
    const channelCount = mat.channels();

    for (let index = 0; index < mat.rows * mat.cols; index++) {
        const offset = index * channelCount;
        for (let channel = 0; channel < channels; channel++) {
            const value = Math.min(255, Math.max(0, Math.round(data[offset + channel] * scale)));
            hist[channel][value]++;
        }
    }

    const stats = hist.map((bins) => {
        const total = bins.reduce((sum, value) => sum + value, 0);
        let min = 255;
        let max = 0;
        let sum = 0;
        for (let value = 0; value < bins.length; value++) {
            if (bins[value]) {
                min = Math.min(min, value);
                max = Math.max(max, value);
            }
            sum += value * bins[value];
        }
        return {
            bins,
            total,
            min,
            max,
            mean: total ? sum / total : 0,
            lowCut: percentile(bins, 0.001),
            highCut: percentile(bins, 0.001, true)
        };
    });

    return {
        hist,
        stats,
        channelNames: isColor ? ['R', 'G', 'B'] : ['L'],
        min: Math.min(...stats.map((item) => item.min)),
        max: Math.max(...stats.map((item) => item.max)),
        lowCut: Math.min(...stats.map((item) => item.lowCut)),
        highCut: Math.max(...stats.map((item) => item.highCut))
    };
}

function percentile(bins, fraction, highSide = false) {
    const total = bins.reduce((sum, value) => sum + value, 0);
    const target = total * fraction;
    let accumulated = 0;
    if (highSide) {
        for (let value = 255; value >= 0; value--) {
            accumulated += bins[value];
            if (accumulated >= target) return value;
        }
        return 255;
    }
    for (let value = 0; value < bins.length; value++) {
        accumulated += bins[value];
        if (accumulated >= target) return value;
    }
    return 0;
}

export function renderHistogram(canvas, histogramData) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, width, height);

    histogramData.stats.forEach((channelStats, index) => {
        const color = ['#d33', '#2d8f3e', '#1e6fe9'][index] || '#666';
        const maxCount = Math.max(...channelStats.bins, 1);
        ctx.beginPath();
        channelStats.bins.forEach((count, value) => {
            const x = (value / 255) * width;
            const y = height - 1 - (count / maxCount) * (height - 16);
            if (value === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.stroke();
    });
}

export function stretchBrightness(srcMat, blackPoint, whitePoint) {
    const black = Math.max(0, Math.min(255, Number(blackPoint)));
    const white = Math.max(black + 1, Math.min(255, Number(whitePoint)));
    const sourceIsFloat = srcMat.depth() === cv.CV_32F || srcMat.depth() === cv.CV_64F;
    const source = sourceIsFloat ? srcMat.data32F : srcMat.data;
    const result = new cv.Mat(srcMat.rows, srcMat.cols, srcMat.type());
    const target = sourceIsFloat ? result.data32F : result.data;
    const scale = sourceIsFloat ? 255 : 1;
    const inverseScale = 1 / scale;
    const channels = srcMat.channels();
    const denominator = white - black;

    for (let index = 0; index < srcMat.rows * srcMat.cols * channels; index += channels) {
        for (let channel = 0; channel < Math.min(3, channels); channel++) {
            const value = source[index + channel] * scale;
            const corrected = Math.max(0, Math.min(255, ((value - black) * 255) / denominator));
            target[index + channel] = corrected * inverseScale;
        }
        if (channels === 4) target[index + 3] = source[index + 3];
    }

    return result;
}
