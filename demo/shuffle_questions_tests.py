from solution import *
def test_same_items():
    qs = ["q1", "q2", "q3"]
    assert sorted(shuffled_questions(qs)) == qs
