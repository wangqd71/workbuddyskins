from __future__ import annotations

import argparse
import sys
from pathlib import Path


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a centered, baseline-locked animated WebP from a sprite sheet.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--opencv-path", type=Path)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--rows", type=int, default=2)
    parser.add_argument("--sequence", default="0,1,3,4")
    parser.add_argument("--inbetweens", type=int, default=11)
    parser.add_argument("--duration", type=int, default=70)
    parser.add_argument("--quality", type=int, default=76)
    parser.add_argument("--width", type=int, default=320)
    return parser.parse_args()


args = arguments()
if args.opencv_path:
    sys.path.insert(0, str(args.opencv_path.resolve()))

try:
    import cv2
    import numpy as np
    from PIL import Image, ImageSequence
except ImportError as error:
    raise SystemExit("Install dependencies: python -m pip install pillow numpy opencv-python-headless") from error


def split_sheet(sheet: Image.Image) -> list[np.ndarray]:
    sheet = sheet.convert("RGBA")
    cell_width = sheet.width // args.columns
    cell_height = sheet.height // args.rows
    frames = []
    for row in range(args.rows):
        for column in range(args.columns):
            left, top = column * cell_width, row * cell_height
            frames.append(np.asarray(sheet.crop((left, top, left + cell_width, top + cell_height)), dtype=np.uint8))
    return frames


def anchor(frame: np.ndarray) -> tuple[float, int]:
    y_values, x_values = np.nonzero(frame[..., 3] > 24)
    if x_values.size == 0:
        return frame.shape[1] / 2.0, frame.shape[0] - 1
    return (float(x_values.min()) + float(x_values.max())) / 2.0, int(y_values.max())


def lock(frame: np.ndarray, target_x: float, target_bottom: int) -> np.ndarray:
    current_x, current_bottom = anchor(frame)
    shift_x, shift_y = int(round(target_x - current_x)), int(round(target_bottom - current_bottom))
    if shift_x == 0 and shift_y == 0:
        return frame
    matrix = np.array([[1.0, 0.0, shift_x], [0.0, 1.0, shift_y]], dtype=np.float32)
    return cv2.warpAffine(frame, matrix, (frame.shape[1], frame.shape[0]), flags=cv2.INTER_NEAREST,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


def luma(frame: np.ndarray) -> np.ndarray:
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    composite = frame[..., :3].astype(np.float32) * alpha + 48.0 * (1.0 - alpha)
    return cv2.cvtColor(composite.astype(np.uint8), cv2.COLOR_RGB2GRAY)


def flow(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    return cv2.calcOpticalFlowFarneback(luma(source), luma(target), None, 0.5, 4, 31, 6, 7, 1.5,
                                        cv2.OPTFLOW_FARNEBACK_GAUSSIAN)


def premultiply(frame: np.ndarray) -> np.ndarray:
    result = frame.astype(np.float32) / 255.0
    result[..., :3] *= result[..., 3:4]
    return result


def warp(image: np.ndarray, movement: np.ndarray, amount: float) -> np.ndarray:
    height, width = movement.shape[:2]
    x, y = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    return cv2.remap(image, x - movement[..., 0] * amount, y - movement[..., 1] * amount,
                     cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


def mix(source: np.ndarray, target: np.ndarray, forward: np.ndarray, backward: np.ndarray, progress: float) -> np.ndarray:
    if progress <= 0:
        return source.copy()
    blended = warp(premultiply(source), forward, progress) * (1.0 - progress)
    blended += warp(premultiply(target), backward, 1.0 - progress) * progress
    alpha = np.clip(blended[..., 3:4], 0.0, 1.0)
    rgb = np.divide(blended[..., :3], np.maximum(alpha, 1.0 / 255.0), out=np.zeros_like(blended[..., :3]))
    rgba = np.concatenate((np.clip(rgb, 0.0, 1.0), alpha), axis=2)
    rgba[alpha[..., 0] < 1.0 / 255.0] = 0
    return np.round(rgba * 255.0).astype(np.uint8)


def main() -> None:
    all_frames = split_sheet(Image.open(args.input))
    indexes = [int(item.strip()) for item in args.sequence.split(",") if item.strip()]
    if len(indexes) < 2 or any(index < 0 or index >= len(all_frames) for index in indexes):
        raise ValueError(f"Invalid sequence: {args.sequence}")
    frames = [all_frames[index] for index in indexes]
    target_x = frames[0].shape[1] / 2.0
    target_bottom = min(frames[0].shape[0] - 8, max(anchor(frame)[1] for frame in frames))
    frames = [lock(frame, target_x, target_bottom) for frame in frames]

    output = []
    samples = args.inbetweens + 1
    for index, source in enumerate(frames):
        target = frames[(index + 1) % len(frames)]
        forward, backward = flow(source, target), flow(target, source)
        for sample in range(samples):
            linear = sample / samples
            eased = linear * linear * (3.0 - 2.0 * linear)
            output.append(Image.fromarray(lock(mix(source, target, forward, backward, eased), target_x, target_bottom), "RGBA"))

    if args.width > 0 and output[0].width != args.width:
        height = round(output[0].height * args.width / output[0].width)
        output = [frame.resize((args.width, height), Image.Resampling.LANCZOS) for frame in output]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output[0].save(args.output, "WEBP", save_all=True, append_images=output[1:], duration=args.duration, loop=0,
                   lossless=False, quality=args.quality, method=3, minimize_size=True, allow_mixed=False)
    with Image.open(args.output) as result:
        decoded = list(ImageSequence.Iterator(result))
        if len(decoded) != len(output) or result.mode != "RGBA":
            raise RuntimeError("Animated WebP validation failed.")
    print(f"Wrote {args.output} ({len(output)} frames, {args.duration} ms/frame)")


if __name__ == "__main__":
    main()
