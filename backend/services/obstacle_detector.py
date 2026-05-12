"""
Obstacle Detector — Fast local object/obstacle detection using OpenCV.
No API calls needed — runs entirely on device for instant alerts.
Uses color segmentation, contour analysis, and depth estimation heuristics.
"""

import logging

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class ObstacleDetector:
    """Detects obstacles and objects using OpenCV (no ML model needed)."""

    # Common obstacle color ranges in HSV
    # Tuned for real-world indoor/outdoor detection
    FLOOR_LOWER = np.array([0, 0, 40])
    FLOOR_UPPER = np.array([180, 80, 200])

    def detect(self, image_bytes: bytes) -> list:
        """
        Detect obstacles in a camera frame.
        Returns list of detected objects with position and urgency.
        """
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            return []

        obstacles = []

        # 1. Large object detection via contours
        obstacles.extend(self._detect_large_objects(frame))

        # 2. Edge/drop detection (stairs, curbs)
        edges = self._detect_edges(frame)
        if edges:
            obstacles.extend(edges)

        # 3. Proximity estimation based on object size in frame
        obstacles = self._estimate_proximity(obstacles, frame.shape)

        # Deduplicate and sort by urgency
        obstacles = self._deduplicate(obstacles)
        obstacles.sort(key=lambda o: 0 if o.get("urgency") == "high" else 1)

        return obstacles[:8]  # Cap at 8 objects

    def _detect_large_objects(self, frame: np.ndarray) -> list:
        """Detect large objects/obstacles via contour analysis."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (11, 11), 0)

        # Adaptive thresholding for varying lighting
        thresh = cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, 25, 5
        )

        # Morphological operations to clean up
        kernel = np.ones((7, 7), np.uint8)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        h, w = frame.shape[:2]
        min_area = (h * w) * 0.02  # At least 2% of frame
        obstacles = []

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < min_area:
                continue

            x, y, cw, ch = cv2.boundingRect(contour)
            center_x = (x + cw / 2) / w
            center_y = (y + ch / 2) / h
            size_ratio = area / (h * w)

            # Determine position label
            position = self._get_position_label(center_x, center_y)

            # Classify by shape and position
            aspect_ratio = cw / ch if ch > 0 else 1
            label = self._classify_obstacle(aspect_ratio, size_ratio, center_y)

            obstacles.append({
                "label": label,
                "position": position,
                "center": [round(center_x, 2), round(center_y, 2)],
                "size": round(size_ratio, 3),
                "urgency": "low",
                "bbox": [x, y, cw, ch],
            })

        return obstacles

    def _detect_edges(self, frame: np.ndarray) -> list:
        """Detect sharp edges that might indicate stairs, curbs, or drops."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h, w = frame.shape[:2]

        # Focus on the lower 60% of the frame (ground area)
        ground_region = gray[int(h * 0.4):, :]

        # Canny edge detection
        edges = cv2.Canny(ground_region, 50, 150)

        # Detect horizontal lines (stairs/curbs)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=80,
                                minLineLength=w * 0.3, maxLineGap=20)

        results = []

        if lines is not None:
            horizontal_lines = []
            for line in lines:
                x1, y1, x2, y2 = line[0]
                angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
                # Nearly horizontal lines
                if angle < 15 or angle > 165:
                    horizontal_lines.append(line[0])

            # Multiple horizontal lines = likely stairs
            if len(horizontal_lines) >= 3:
                results.append({
                    "label": "stairs or steps",
                    "position": "ahead on ground",
                    "center": [0.5, 0.8],
                    "size": 0.1,
                    "urgency": "high",
                })
            elif len(horizontal_lines) >= 1:
                results.append({
                    "label": "edge or curb",
                    "position": "ahead on ground",
                    "center": [0.5, 0.8],
                    "size": 0.05,
                    "urgency": "medium",
                })

        # Check for sudden brightness changes (drop-offs)
        bottom_strip = gray[int(h * 0.85):, :]
        if bottom_strip.size > 0:
            brightness_std = np.std(bottom_strip)
            if brightness_std > 60:
                results.append({
                    "label": "uneven surface",
                    "position": "directly ahead",
                    "center": [0.5, 0.95],
                    "size": 0.05,
                    "urgency": "medium",
                })

        return results

    def _estimate_proximity(self, obstacles: list, frame_shape: tuple) -> list:
        """Estimate how close obstacles are based on their size in frame."""
        h, w = frame_shape[:2]

        for obs in obstacles:
            size = obs.get("size", 0)
            center_y = obs.get("center", [0.5, 0.5])[1]

            # Objects that are large or in bottom half = close
            if size > 0.15 or center_y > 0.75:
                obs["urgency"] = "high"
                obs["distance"] = "very close"
            elif size > 0.08 or center_y > 0.6:
                obs["urgency"] = "medium" if obs["urgency"] != "high" else "high"
                obs["distance"] = "nearby"
            else:
                obs["distance"] = "far"
                if obs["urgency"] != "high":
                    obs["urgency"] = "low"

        return obstacles

    def _get_position_label(self, cx: float, cy: float) -> str:
        """Convert center coordinates to human-readable position."""
        if cx < 0.33:
            horiz = "to your left"
        elif cx > 0.67:
            horiz = "to your right"
        else:
            horiz = "ahead"

        if cy > 0.7:
            vert = "close"
        elif cy > 0.4:
            vert = ""
        else:
            vert = "far"

        parts = [p for p in [vert, horiz] if p]
        return " ".join(parts) if parts else "ahead"

    def _classify_obstacle(self, aspect_ratio: float, size: float, y_pos: float) -> str:
        """Classify obstacle type by its shape characteristics."""
        if aspect_ratio > 3:
            return "wall or barrier"
        elif aspect_ratio > 1.5:
            return "wide object"
        elif aspect_ratio < 0.4:
            return "tall object"
        elif size > 0.2:
            return "large obstacle"
        elif y_pos > 0.7:
            return "object on ground"
        else:
            return "object"

    def _deduplicate(self, obstacles: list) -> list:
        """Remove overlapping detections."""
        if len(obstacles) <= 1:
            return obstacles

        result = []
        used = set()

        for i, obs in enumerate(obstacles):
            if i in used:
                continue
            result.append(obs)
            for j in range(i + 1, len(obstacles)):
                if j in used:
                    continue
                # Check if centers are close
                ci = obs.get("center", [0, 0])
                cj = obstacles[j].get("center", [0, 0])
                dist = ((ci[0] - cj[0]) ** 2 + (ci[1] - cj[1]) ** 2) ** 0.5
                if dist < 0.15:
                    used.add(j)

        return result
