export class MaskTool {
    constructor({ getPosition, getRadius, paint, onChange }) {
        this.getPosition = getPosition;
        this.getRadius = getRadius;
        this.paint = paint;
        this.onChange = onChange;
        this.active = false;
        this.lastPoint = null;
    }

    pointerDown(event) {
        const point = this.getPosition(event);
        this.active = true;
        this.lastPoint = point;
        this.paint(point, point, this.getRadius());
        this.onChange();
    }

    pointerMove(event) {
        if (!this.active) return;
        const point = this.getPosition(event);
        this.paint(this.lastPoint || point, point, this.getRadius());
        this.lastPoint = point;
        this.onChange();
    }

    pointerUp() {
        this.active = false;
        this.lastPoint = null;
    }
}

export class ReferenceTool {
    constructor({ getPosition, getRadius, points, getType, onChange }) {
        this.getPosition = getPosition;
        this.getRadius = getRadius;
        this.points = points;
        this.getType = getType;
        this.onChange = onChange;
        this.draggedIndex = -1;
    }

    pointerDown(event) {
        const point = this.getPosition(event);
        const radius = this.getRadius();
        this.draggedIndex = this.points.findIndex((candidate) =>
            Math.hypot(candidate.x - point.x, candidate.y - point.y) <= radius
        );
        if (this.draggedIndex === -1) {
            this.points.push({ ...point, type: this.getType() });
            this.draggedIndex = this.points.length - 1;
        }
        this.onChange();
    }

    pointerMove(event) {
        if (this.draggedIndex === -1) return;
        const point = this.getPosition(event);
        this.points[this.draggedIndex] = {
            ...this.points[this.draggedIndex],
            ...point
        };
        this.onChange();
    }

    pointerUp(isInsideImage) {
        if (this.draggedIndex !== -1 && !isInsideImage(this.points[this.draggedIndex])) {
            this.points.splice(this.draggedIndex, 1);
        }
        this.draggedIndex = -1;
        this.onChange();
    }
}

export class GeometryTool {
    constructor({ getPosition, getHitRadius, getPoints, isEnabled, onChange }) {
        this.getPosition = getPosition;
        this.getHitRadius = getHitRadius;
        this.getPoints = getPoints;
        this.isEnabled = isEnabled;
        this.onChange = onChange;
        this.draggedIndex = -1;
    }

    pointerDown(event) {
        if (!this.isEnabled()) return;
        const point = this.getPosition(event);
        const points = this.getPoints();
        this.draggedIndex = points.findIndex((candidate) =>
            Math.hypot(candidate.x - point.x, candidate.y - point.y) < this.getHitRadius()
        );
    }

    pointerMove(event) {
        if (this.draggedIndex === -1) return;
        const point = this.getPosition(event);
        const points = this.getPoints();
        points[this.draggedIndex].x = point.x;
        points[this.draggedIndex].y = point.y;
        this.onChange();
    }

    pointerUp() {
        this.draggedIndex = -1;
    }
}
