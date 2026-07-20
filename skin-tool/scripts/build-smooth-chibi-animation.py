from __future__ import annotations

import argparse
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a smooth animated WebP from the 4x2 chibi sprite sheet.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--opencv-path", type=Path)
    parser.add_argument("--inbetweens", type=int, default=4)
    parser.add_argument("--duration", type=int, default=42, help="Milliseconds per output frame.")
    parser.add_argument("--quality", type=int, default=88)
    parser.add_argument("--width", type=int, default=0, help="Optional final animation width.")
    parser.add_argument(
        "--sequence",
        default="0,1,2,3,4,5,6,7",
        help="Comma-separated source-frame indexes used for the loop.",
    )
    return parser.parse_args()


args = parse_args()
if args.opencv_path:
    sys.path.insert(0, str(args.opencv_path.resolve()))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageSequence  # noqa: E402


def split_sheet(sheet: Image.Image) -> list[np.ndarray]:
    sheet = sheet.convert("RGBA")
    cell_width = sheet.width // 4
    cell_height = sheet.height // 2
    frames: list[np.ndarray] = []
    for row in range(2):
        for column in range(4):
            left = column * cell_width
            top = row * cell_height
            crop = sheet.crop((left, top, left + cell_width, top + cell_height))
            frames.append(np.asarray(crop, dtype=np.uint8))
    return frames


def foot_anchor(frame: np.ndarray) -> tuple[float, int]:
    alpha = frame[..., 3]
    y_values, x_values = np.nonzero(alpha > 24)
    if x_values.size == 0:
        return frame.shape[1] / 2.0, frame.shape[0] - 1
    bottom = int(y_values.max())
    silhouette_center = (float(x_values.min()) + float(x_values.max())) / 2.0
    return silhouette_center, bottom


def lock_to_anchor(frame: np.ndarray, target_x: float, target_bottom: int) -> np.ndarray:
    current_x, current_bottom = foot_anchor(frame)
    shift_x = int(round(target_x - current_x))
    shift_y = int(round(target_bottom - current_bottom))
    if shift_x == 0 and shift_y == 0:
        return frame
    transform = np.array([[1.0, 0.0, shift_x], [0.0, 1.0, shift_y]], dtype=np.float32)
    return cv2.warpAffine(
        frame,
        transform,
        (frame.shape[1], frame.shape[0]),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )


def flow_luma(frame: np.ndarray) -> np.ndarray:
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    rgb = frame[..., :3].astype(np.float32)
    composite = rgb * alpha + 48.0 * (1.0 - alpha)
    return cv2.cvtColor(composite.astype(np.uint8), cv2.COLOR_RGB2GRAY)


def dense_flow(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    return cv2.calcOpticalFlowFarneback(
        flow_luma(source),
        flow_luma(target),
        None,
        pyr_scale=0.5,
        levels=4,
        winsize=31,
        iterations=6,
        poly_n=7,
        poly_sigma=1.5,
        flags=cv2.OPTFLOW_FARNEBACK_GAUSSIAN,
    )


def premultiply(frame: np.ndarray) -> np.ndarray:
    result = frame.astype(np.float32) / 255.0
    result[..., :3] *= result[..., 3:4]
    return result


def warp(image: np.ndarray, flow: np.ndarray, amount: float) -> np.ndarray:
    height, width = flow.shape[:2]
    x, y = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    map_x = x - flow[..., 0].astype(np.float32) * amount
    map_y = y - flow[..., 1].astype(np.float32) * amount
    return cv2.remap(
        image,
        map_x,
        map_y,
        interpolation=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )


def interpolate(source: np.ndarray, target: np.ndarray, progress: float) -> np.ndarray:
    if progress <= 0.0:
        return source.copy()
    forward = dense_flow(source, target)
    backward = dense_flow(target, source)
    source_warped = warp(premultiply(source), forward, progress)
    target_warped = warp(premultiply(target), backward, 1.0 - progress)
    mixed = source_warped * (1.0 - progress) + target_warped * progress
    alpha = np.clip(mixed[..., 3:4], 0.0, 1.0)
    rgb = np.divide(mixed[..., :3], np.maximum(alpha, 1.0 / 255.0), out=np.zeros_like(mixed[..., :3]))
    rgba = np.concatenate((np.clip(rgb, 0.0, 1.0), alpha), axis=2)
    rgba[alpha[..., 0] < (1.0 / 255.0)] = 0.0
    return np.round(rgba * 255.0).astype(np.uint8)


def main() -> None:
    all_frames = split_sheet(Image.open(args.input))
    sequence = [int(value.strip()) for value in args.sequence.split(",") if value.strip()]
    if len(sequence) < 2 or any(index < 0 or index >= len(all_frames) for index in sequence):
        raise ValueError(f"Invalid frame sequence: {args.sequence}")
    source_frames = [all_frames[index] for index in sequence]
    target_x = source_frames[0].shape[1] / 2.0
    target_bottom = min(
        source_frames[0].shape[0] - 8,
        max(foot_anchor(frame)[1] for frame in source_frames),
    )
    source_frames = [lock_to_anchor(frame, target_x, target_bottom) for frame in source_frames]
    output_frames: list[Image.Image] = []
    samples_per_segment = args.inbetweens + 1
    for index, source in enumerate(source_frames):
        target = source_frames[(index + 1) % len(source_frames)]
        forward = dense_flow(source, target)
        backward = dense_flow(target, source)
        source_pm = premultiply(source)
        target_pm = premultiply(target)
        for sample in range(samples_per_segment):
            linear_progress = sample / samples_per_segment
            progress = linear_progress * linear_progress * (3.0 - 2.0 * linear_progress)
            if sample == 0:
                frame = source.copy()
            else:
                source_warped = warp(source_pm, forward, progress)
                target_warped = warp(target_pm, backward, 1.0 - progress)
                mixed = source_warped * (1.0 - progress) + target_warped * progress
                alpha = np.clip(mixed[..., 3:4], 0.0, 1.0)
                rgb = np.divide(
                    mixed[..., :3],
                    np.maximum(alpha, 1.0 / 255.0),
                    out=np.zeros_like(mixed[..., :3]),
                )
                rgba = np.concatenate((np.clip(rgb, 0.0, 1.0), alpha), axis=2)
                rgba[alpha[..., 0] < (1.0 / 255.0)] = 0.0
                frame = np.round(rgba * 255.0).astype(np.uint8)
            frame = lock_to_anchor(frame, target_x, target_bottom)
            output_frames.append(Image.fromarray(frame, mode="RGBA"))

    if args.width > 0 and output_frames[0].width != args.width:
        output_height = round(output_frames[0].height * args.width / output_frames[0].width)
        output_frames = [
            frame.resize((args.width, output_height), Image.Resampling.LANCZOS)
            for frame in output_frames
        ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output_frames[0].save(
        args.output,
        format="WEBP",
        save_all=True,
        append_images=output_frames[1:],
        duration=args.duration,
        loop=0,
        lossless=False,
        quality=args.quality,
        method=3,
        minimize_size=True,
        allow_mixed=False,
    )

    with Image.open(args.output) as result:
        decoded = sum(1 for _ in ImageSequence.Iterator(result))
        if decoded != len(output_frames):
            raise RuntimeError(f"Expected {len(output_frames)} frames, decoded {decoded}.")
        if result.mode != "RGBA":
            raise RuntimeError(f"Expected RGBA animation, got {result.mode}.")
    print(f"Wrote {args.output} ({len(output_frames)} frames, {args.duration} ms/frame)")


if __name__ == "__main__":
    main()
