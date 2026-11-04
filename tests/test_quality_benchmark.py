"""Metrics tested against an independent ordinary dynamic-programming oracle."""
import itertools

from tests.benchmark.quality_metrics import compare_reports, edit_distance, text_metrics, timing_metrics


def test_exact_distance_matches_dp_for_all_short_strings():
    def oracle(a, b):
        row = list(range(len(b)+1))
        for i, left in enumerate(a, 1):
            nxt = [i]
            for j, right in enumerate(b, 1):
                nxt.append(min(nxt[-1]+1, row[j]+1, row[j-1]+(left != right)))
            row = nxt
        return row[-1]
    strings = ["".join(chars) for n in range(5) for chars in itertools.product("ab", repeat=n)]
    for a in strings:
        for b in strings:
            assert edit_distance(a, b) == oracle(a, b)


def test_reference_metrics_cover_silence_omission_and_multilingual_text():
    assert text_metrics("你好，World!", "你好 world")["cer"] == 0
    assert text_metrics("a b", "a c")["wer"] == .5
    assert text_metrics("hello,this", "hello this")["wer"] == 0
    assert text_metrics("你好", "")["empty_omission"] is True
    assert text_metrics("", "感谢观看")["unexpected_text_units"] == 4
    assert text_metrics(None, "")["cer"] is None


def test_timing_only_scores_unambiguous_text():
    span = {"text": "hello", "start": 1., "end": 2.}
    assert timing_metrics([span], [{**span, "end": 3}])["mean_boundary_offset_seconds"] == .5
    assert timing_metrics([span], [span, span])["mean_boundary_offset_seconds"] is None
    assert timing_metrics([span], [])["missing_reference_spans"] == ["hello"]


def test_comparison_rejects_changed_inputs_and_reports_individual_regressions():
    row = {"sample_id": "one", "model_id": "model", "status": "completed", "input_sha256": "fixed",
           "reference_sha256": "ref", "preset_id": "cn", "parameters": {}, "metrics": {"cer": .1}}
    after = {**row, "metrics": {"cer": .2}}
    assert compare_reports({"results": [row]}, {"results": [after]})[0]["delta_candidate_minus_baseline"]["cer"] == .1
    assert not compare_reports({"results": [row]}, {"results": [{**after, "input_sha256": "other"}]})[0]["comparable"]


def test_runner_reads_probe_contract_and_actual_output_formats(monkeypatch, tmp_path):
    import io
    import json
    import os
    from types import SimpleNamespace
    from tests.benchmark import run_quality_benchmark as runner
    def launch(*args, **kwargs):
        target = kwargs["cwd"]
        paths = [target / f"sample{suffix}" for suffix in (".txt", ".md", ".srt")]
        for path in paths:
            path.write_text("hello" if path.suffix != ".srt" else "1\n00:00:00,000 --> 00:00:01,000\nhello\n", encoding="utf-8")
        messages = [{"event": "worker.ready"}, {"event": "task.completed", "data": {
            "failure_count": 0, "success_count": 1, "outputs": [str(p) for p in paths]}}]
        return SimpleNamespace(pid=os.getpid(), stdin=io.StringIO(), stdout=io.StringIO(
            "\n".join(json.dumps(m) for m in messages)))
    monkeypatch.setattr(runner.subprocess, "Popen", launch)
    monkeypatch.setattr(runner, "parse_protocol_line", lambda _: None)
    monkeypatch.setattr(runner, "wait_for_exit", lambda *args: True)
    monkeypatch.setattr(runner, "default_media_duration_probe", lambda _: (True, 1., None))
    media = tmp_path / "source.wav"
    media.write_bytes(b"unit test only")
    result = runner.run_sample(SimpleNamespace(model_dir=tmp_path, worker_executable=None, timeout=10),
        {"id": "fixture", "resolved_path": media, "preset_id": "en_v1", "category": "test", "reference_text": "hello"},
        "large-v3-turbo", tmp_path / "output", None)
    assert result["status"] == "completed"
    assert result["metrics"]["duration_seconds"] == 1.
    assert result["metrics"]["cer"] == 0


def test_corpus_declares_missing_categories_without_inventing_results():
    from tests.benchmark.run_quality_benchmark import ROOT, load_samples
    samples = load_samples(ROOT / "tests/benchmark/quality_corpus.json")
    assert len(samples) == 8
    assert sum(bool(s.get("resolved_path")) for s in samples) == 2
