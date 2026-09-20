// Поворот рабочей матрицы на 90 градусов; работает напрямую с float без конвертации в 8-бит.
export function rotateMat(src, direction) {
    const rotateCode = direction === 'left' ? cv.ROTATE_90_COUNTERCLOCKWISE : cv.ROTATE_90_CLOCKWISE;
    const dst = new cv.Mat();
    cv.rotate(src, dst, rotateCode);
    return dst;
}
