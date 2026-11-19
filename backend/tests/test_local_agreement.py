import uuid

from worker.asr.language import script_language, transliterate
from worker.asr.local_agreement import LiveCommitter, Word, normalize

NS = uuid.UUID("12345678-1234-5678-1234-567812345678")


def words(*items: tuple[str, float, float]) -> list[Word]:
    return [Word(text, start, end, 0.9) for text, start, end in items]


def test_commits_only_words_agreed_by_two_consecutive_runs() -> None:
    c = LiveCommitter(NS)
    first = c.update(words((" Round", 0.0, 0.4), (" robin", 0.4, 0.8)), window_end=1.0)
    assert first.finals == [] and first.partial is not None and first.partial.text == "Round robin"
    assert c.committed_until == 0.0
    second = c.update(words((" Round", 0.0, 0.4), (" robin", 0.4, 0.8), (" uses", 0.8, 1.1)), window_end=1.5)
    assert c.committed_until == 0.8  # "Round robin" agreed → committed
    assert second.finals == []  # no sentence end yet: still part of the open segment
    assert second.partial is not None and second.partial.text == "Round robin uses"


def test_sentence_end_closes_segment_and_partial_keeps_its_id() -> None:
    c = LiveCommitter(NS)
    hyp = words((" Time", 0.0, 0.3), (" quantum.", 0.3, 0.9), (" Next", 1.2, 1.5))
    partial = c.update(hyp, 1.6).partial
    assert partial is not None
    update = c.update(hyp + words((" topic", 1.5, 1.9)), 2.0)
    assert [s.text for s in update.finals] == ["Time quantum."]
    assert update.finals[0].segment_id == partial.segment_id  # final replaces the partial in place
    assert update.finals[0].start_ms == 0 and update.finals[0].end_ms == 900
    assert update.partial is not None and update.partial.segment_id != partial.segment_id
    assert update.partial.text == "Next topic"


def test_disagreement_is_not_committed() -> None:
    c = LiveCommitter(NS)
    c.update(words((" The", 0.0, 0.2), (" convoy", 0.2, 0.6)), 1.0)
    c.update(words((" The", 0.0, 0.2), (" convey", 0.2, 0.6)), 1.5)
    assert c.committed_until == 0.2  # only "The" agreed
    c.update(words((" convoy", 0.2, 0.6), (" effect", 0.6, 1.0)), 2.0)
    assert c.committed_until == 0.2  # "convoy" vs previous "convey": still unstable


def test_pause_and_max_length_close_segments() -> None:
    c = LiveCommitter(NS, max_segment_s=1.5)
    hyp = words(
        (" one", 0.0, 0.5), (" two", 1.5, 2.0), (" three", 2.1, 2.6), (" four", 2.7, 3.2), (" five", 3.3, 3.6)
    )
    c.update(hyp, 4.0)
    update = c.update(hyp, 4.5)
    assert [s.text for s in update.finals] == ["one", "two three four"]


def test_flush_commits_everything_once() -> None:
    c = LiveCommitter(NS)
    hyp = words((" final", 0.0, 0.4), (" words", 0.4, 0.8))
    c.update(hyp, 1.0)
    finals = c.flush()
    assert [s.text for s in finals] == ["final words"]
    assert c.flush() == []
    # Words before the committed point are never emitted again.
    assert c.update(hyp, 1.5).partial is None


def test_window_safety_valve_forces_progress() -> None:
    c = LiveCommitter(NS, max_window_s=10.0)
    c.update(words((" a", 0.0, 1.0)), 5.0)
    c.update(words((" b", 0.0, 1.0)), 11.0)  # never agrees, window too long
    assert c.committed_until > 0.0


def test_normalize_keeps_indic_vowel_signs() -> None:
    assert normalize(" షెడ్యూలింగ్,") == "షెడ్యూలింగ్"
    assert normalize("Quantum!") == normalize("quantum")


def test_script_language_and_transliteration() -> None:
    assert script_language("Round robin uses a time quantum.") == "en"
    assert script_language("ఇప్పుడు మనం CPU scheduling గురించి చూద్దాం.") == "te"
    assert script_language("Priority scheduling में starvation की problem आती है।") == "hi"
    assert script_language("123 ...") == "en"
    assert script_language("Okay, अच्छा let us continue with round robin now") == "en"
    assert transliterate("ఇప్పుడు మనం CPU scheduling", "te") == "ippuḍu manaṁ CPU scheduling"
    assert transliterate("शेड्यूलिंग है", "hi") == "śēḍyūliṁga hai"
    assert transliterate("hello", "en") is None
