/**
 * Высокоточный и быстрый модуль очистки фона через пирамиду масштабирования
 */
export function normalizeBrightness(srcMat, contrastFactor = 1.1, brightnessOffset = -10) {
    let channels = new cv.MatVector();
    let cleanedChannels = new cv.MatVector();
    
    cv.split(srcMat, channels);

    // 1. Задаем фиксированный небольшой размер для расчета карты освещения
    // Сжатие картинки до 400px убирает детали рисунка и оставляет только чистый градиент света
    let lowResWidth = 400;
    let lowResHeight = Math.round((srcMat.rows / srcMat.cols) * lowResWidth);
    let lowResSize = new cv.Size(lowResWidth, lowResHeight);
    let origSize = new cv.Size(srcMat.cols, srcMat.rows);

    for (let i = 0; i < 3; i++) {
        let channel = channels.get(i);
        
        // Шаг А: Сжимаем канал до минимума (это мгновенно и убирает мелкие штрихи)
        let lowRes = new cv.Mat();
        cv.resize(channel, lowRes, lowResSize, 0, 0, cv.INTER_LINEAR);

        // Шаг Б: Размываем сжатую копию микроскопическим ядром (работает за доли миллисекунды)
        let lowResBlurred = new cv.Mat();
        cv.GaussianBlur(lowRes, lowResBlurred, new cv.Size(31, 31), 0);

        // Шаг В: Растягиваем карту освещения обратно до исходного разрешения бикубическим методом
        let background = new cv.Mat();
        cv.resize(lowResBlurred, background, origSize, 0, 0, cv.INTER_CUBIC);

        // Шаг Г: Делим оригинал на карту света. Бумага становится идеально белой, светлячков по краям нет
        let normalized = new cv.Mat();
        cv.divide(channel, background, normalized, 255);

        // Шаг Д: Применяем ручные настройки контраста и яркости штриха
        let finalChannel = new cv.Mat();
        cv.convertScaleAbs(normalized, finalChannel, contrastFactor, brightnessOffset);

        cleanedChannels.push_back(finalChannel);

        // Чистим память временных матриц
        channel.delete(); lowRes.delete(); lowResBlurred.delete(); background.delete(); normalized.delete();
    }

    if (channels.size() > 3) {
        cleanedChannels.push_back(channels.get(3));
    }

    let resultMat = new cv.Mat();
    cv.merge(cleanedChannels, resultMat);

    channels.delete();
    cleanedChannels.delete();

    return resultMat;
}
