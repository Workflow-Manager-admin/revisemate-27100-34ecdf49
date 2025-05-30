import React, { useState, useRef } from 'react';

// PUBLIC_INTERFACE
/**
 * MainContainer is the core component for ReviseMate.
 * Features:
 * - Minimalist, responsive, student-friendly UI
 * - File upload for PDF or DOCX
 * - In-browser text extraction (pdfjs-dist & mammoth.js)
 * - MCQ generation using external LLM API (user-provided key)
 * - Touch-friendly interactive quiz presenting MCQs 1 at a time
 * - Offline support for static assets & simple service worker caching
 */
const initialState = {
  extractedText: '',
  fileName: '',
  questions: [],
  apiKey: '',
  quizStarted: false,
  quizIdx: 0,
  userAnswers: [],
  showAnswer: false,
  loading: false,
  apiError: '',
  fileError: '',
};

const themeColors = {
  primary: '#000000', // main background
  secondary: '#f1f5f9', // cards/surfaces
  accent: '#fbbf24', // CTAs/highlights
};

function MainContainer() {
  const [state, setState] = useState(initialState);
  const fileInputRef = useRef(null);

  // Handles file input change: loads PDF or DOCX
  const handleFileInput = async (e) => {
    setState((prev) => ({
      ...prev, fileError: '', loading: true, extractedText: '', fileName: '', questions: [],
    }));
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/(pdf|docx)$/i.test(file.name)) {
      setState((prev) => ({ ...prev, fileError: 'Only PDF or DOCX files are supported.', loading: false }));
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      let text = '';
      if (file.name.endsWith('.pdf')) {
        text = await extractTextFromPDF(arrayBuffer);
      } else if (file.name.endsWith('.docx')) {
        text = await extractTextFromDOCX(arrayBuffer);
      }
      if (!text.trim()) throw new Error('No text found. Try a different file?');
      setState((prev) => ({
        ...prev, extractedText: text, fileName: file.name, fileError: '', loading: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev, fileError: err.message || 'Could not extract text.', loading: false,
      }));
    }
  };

  // Loads pdfjs-dist dynamically and extracts text from PDF
  async function extractTextFromPDF(arrayBuffer) {
    try {
      let pdfjsLib;
      try {
        pdfjsLib = await import('pdfjs-dist/build/pdf');
      } catch {
        throw new Error('Failed to load pdfjs-dist for PDF extraction.');
      }
      // Assign workerSrc using a single string line to avoid unterminated errors
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => item.str).join(' ');
        fullText += pageText + '\n\n';
      }
      return fullText;
    } catch (err) {
      throw new Error('Error extracting text from PDF file.');
    }
  }

  // Loads mammoth.js dynamically and extracts text from DOCX
  async function extractTextFromDOCX(arrayBuffer) {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } catch (err) {
      throw new Error('Error extracting text from DOCX file.');
    }
  }

  // Handles API key input
  const handleApiKeyInput = (e) => {
    setState((prev) => ({
      ...prev, apiKey: e.target.value,
    }));
  };

  // Handles MCQ generation via external LLM API with provided API key
  const handleGenerateMCQ = async () => {
    setState((prev) => ({
      ...prev, loading: true, apiError: '', questions: [],
    }));

    // --- MCQ Prompt for LLM ---
    const prompt = `Generate 7 multiple-choice questions (MCQs) from the following text. For each question, give:
1. question
2. options (A, B, C, D)
3. correct_option (A/B/C/D)
Format as valid JSON array:
[
  {"question": "...", "options": {"A": "...", "B": "...", "C": "...", "D": "..."}, "correct_option": "A"},
  ...
]
Text:
${state.extractedText.slice(0, 5000)}
`;

    try {
      // Use OpenAI's API as default, let user input key.
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are an assistant that creates clear MCQs for students.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 1800,
        }),
      });
      if (!response.ok) {
        throw new Error(`API error. Check your API key (${response.status}).`);
      }
      const data = await response.json();
      // Find first JSON array in text (may not always be perfectly formatted)
      const text = data.choices?.[0]?.message.content || '';
      let jsonStr = '';
      try {
        const jsonMatch = text.match(/\[([\s\S]+?)\]/);
        jsonStr = jsonMatch ? `[${jsonMatch[1]}]` : text;
        // eslint-disable-next-line no-eval
        const questions = JSON.parse(jsonStr.replace(/(```json|```)/g, ''));
        if (!Array.isArray(questions) || !questions[0]?.question) throw new Error();
        setState((prev) => ({
          ...prev, questions, loading: false, quizStarted: true, quizIdx: 0, userAnswers: Array(questions.length).fill(null), showAnswer: false,
        }));
      } catch {
        throw new Error('Could not parse MCQs. Try again.');
      }
    } catch (err) {
      setState((prev) => ({
        ...prev, apiError: err.message || 'MCQ generation failed.', loading: false,
      }));
    }
  };

  // Handles answer selection for a quiz question
  const handleSelectOption = (idx, option) => {
    if (state.userAnswers[idx] !== null) return; // prevent changes after first pick
    setState((prev) => {
      const newAnswers = [...prev.userAnswers];
      newAnswers[idx] = option;
      return {
        ...prev,
        userAnswers: newAnswers,
        showAnswer: true,
      };
    });
  };

  // Move to next question
  const handleNextQuestion = () => {
    if (state.quizIdx + 1 < state.questions.length) {
      setState((prev) => ({
        ...prev,
        quizIdx: prev.quizIdx + 1,
        showAnswer: false,
      }));
    }
  };

  // Move to previous question
  const handlePrevQuestion = () => {
    if (state.quizIdx > 0) {
      setState((prev) => ({
        ...prev,
        quizIdx: prev.quizIdx - 1,
        showAnswer: false,
      }));
    }
  };

  // Reset all
  const handleResetQuiz = () => setState(initialState);

  // UI elements
  return (
    <div style={{
      background: themeColors.primary,
      minHeight: '100vh',
      color: '#fff',
      fontFamily: "'Inter', 'Roboto', sans-serif",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      justifyContent: 'flex-start',
    }}>
      <header style={{
        background: themeColors.primary,
        borderBottom: `1px solid #2f2f2f`,
        padding: '16px 0',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div style={{
          maxWidth: 480,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{
            fontSize: 28, fontWeight: 700, color: themeColors.accent, marginRight: 8,
          }}>★</span>
          <span style={{
            fontSize: 22, fontWeight: 500, color: '#fff',
          }}>ReviseMate</span>
        </div>
      </header>
      <main style={{
        flex: 1,
        padding: '32px 8px 24px',
        width: '100%',
        maxWidth: 500,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}>
        {/* Upload / extract screen */}
        {!state.quizStarted && (
          <div style={{
            background: themeColors.secondary,
            color: '#171717',
            borderRadius: 14,
            boxShadow: '0 2px 16px 0 #0001',
            padding: 22,
            marginBottom: 16,
            marginTop: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            alignItems: 'center',
          }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: themeColors.primary, marginBottom: 12 }}>
              Reimagined Quizlet for students
            </div>
            <div style={{
              color: '#4b5563', fontSize: 15, lineHeight: 1.4, marginBottom: 6,
              textAlign: 'center', maxWidth: 360,
            }}>
              Upload a <b>PDF</b> or <b>Word (.docx)</b> file. ReviseMate will extract questions from your notes using AI, all on your device. <br />
              <span style={{ fontSize:12 }}>No login, no backend, your API key stays private.</span>
            </div>
            <input
              type="file"
              accept=".pdf,.docx"
              ref={fileInputRef}
              id="file-upload"
              style={{ display: 'none' }}
              onChange={handleFileInput}
              aria-label="File Upload"
            />
            <button
              className="btn"
              style={{
                background: themeColors.accent,
                color: '#222',
                fontWeight: 600,
                fontSize: 17,
                border: 0,
                borderRadius: 6,
                padding: '0.7em 1.7em',
                boxShadow: '0 2px 6px #0002',
                marginBottom: 2,
              }}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={state.loading}
            >
              {state.loading ? 'Extracting...' : (state.fileName ? `Change File` : `Upload .pdf / .docx`)}
            </button>
            {state.fileName && (
              <div style={{ color: themeColors.primary, fontSize: 15, marginTop: -6 }}>
                <span style={{ opacity: 0.8, fontWeight: 600 }}>✓</span> {state.fileName}
              </div>
            )}
            {state.fileError && (
              <div role="alert" style={{
                color: '#b91c1c', fontSize: 14, background: '#fff8f7', borderRadius: 6, padding: 8,
              }}>{state.fileError}</div>
            )}

            {/* API Key input */}
            <label htmlFor="api-key" style={{ marginTop: 15, fontSize: 14, color: themeColors.primary, alignSelf: 'flex-start' }}>
              Enter your OpenAI API key (never stored):
            </label>
            <input
              value={state.apiKey}
              onChange={handleApiKeyInput}
              type="password"
              id="api-key"
              autoComplete="off"
              placeholder="sk-..."
              spellCheck={false}
              style={{
                width: '100%',
                fontSize: 16,
                padding: '8px',
                borderRadius: 5,
                border: '1px solid #cbd5e1',
                marginBottom: 6,
                marginTop: 2,
                background: '#f5f5f5',
                color: '#222',
                letterSpacing: 1,
              }}
              aria-label="OpenAI API key"
            />
            <div style={{ fontSize:12, color:'#555', marginBottom:5 }}>
              Get one from <a href="https://platform.openai.com/api-keys" style={{color:'#000', textDecoration:'underline'}} target="_blank" rel="noopener noreferrer">OpenAI</a>.
            </div>
            {(!!state.extractedText && !!state.apiKey) && (
              <button
                className="btn"
                style={{
                  background: themeColors.accent,
                  color: '#222',
                  fontWeight: 600,
                  fontSize: 17,
                  padding: '0.7em 1.7em',
                  borderRadius: 6,
                  marginTop: 8,
                  marginBottom: 4,
                  border: 0,
                  boxShadow: '0 2px 6px #0001',
                }}
                onClick={handleGenerateMCQ}
                disabled={state.loading}
              >
                {state.loading ? 'Generating Questions...' : 'Generate MCQs'}
              </button>
            )}
            {state.apiError && (
              <div role="alert" style={{
                color: '#b91c1c', fontSize: 14, background: '#fff8f7', borderRadius: 6, padding: 8,
              }}>{state.apiError}</div>
            )}
            {/* Accessibility & privacy */}
            <div style={{
              marginTop: 10, color: '#555', fontSize: 12, textAlign: 'center',
              lineHeight: 1.3, opacity: 0.85,
            }}>
              <span role="img" aria-label="lock">🔒</span> Your files and API key are never uploaded to any server except the AI API for your questions.<br />
              Works on all modern mobile browsers. Offline when installed.
            </div>
          </div>
        )}
        {/* Quiz UI */}
        {state.quizStarted && (
          <QuizPanel
            questions={state.questions}
            quizIdx={state.quizIdx}
            userAnswers={state.userAnswers}
            showAnswer={state.showAnswer}
            onSelectOption={handleSelectOption}
            onNext={handleNextQuestion}
            onPrev={handlePrevQuestion}
            onReset={handleResetQuiz}
          />
        )}
        {/* App footer */}
        <div style={{
          marginTop: 'auto',
          fontSize: 12,
          color: '#cbd5e1',
          textAlign: 'center',
          padding: 12,
          opacity: 0.75,
        }}>
          ReviseMate &copy; {new Date().getFullYear()} • No login · No backend · Open source
        </div>
      </main>
    </div>
  );
}

// Quiz panel component
function QuizPanel({
  questions,
  quizIdx,
  userAnswers,
  showAnswer,
  onSelectOption,
  onNext,
  onPrev,
  onReset,
}) {
  const question = questions[quizIdx];
  return (
    <section
      aria-label="Quiz"
      style={{
        background: '#fff',
        color: '#171717',
        borderRadius: 15,
        padding: 22,
        minHeight: 300,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 18,
        boxShadow: '0 1px 12px #0002',
        marginTop: 24,
        marginBottom: 16,
      }}
    >
      <div style={{
        fontSize: 15, color: '#3b3b3b', marginBottom: 0, marginTop: -5,
      }}>
        Question <b>{quizIdx + 1}</b> of {questions.length}
      </div>
      <div role="main" style={{ fontWeight: 600, fontSize: 20, marginBottom: 6, color: '#000' }}>
        {question.question}
      </div>
      <div>
        {['A', 'B', 'C', 'D'].map((opt) => (
          <QuizOption
            label={opt}
            text={question.options[opt]}
            picked={userAnswers[quizIdx] === opt}
            correct={question.correct_option === opt}
            showAnswer={showAnswer || userAnswers[quizIdx] !== null}
            onClick={() => onSelectOption(quizIdx, opt)}
            disabled={userAnswers[quizIdx] !== null}
            key={opt}
          />
        ))}
      </div>
      {/* Show feedback on answer */}
      {userAnswers[quizIdx] && (
        <div aria-live="polite"
          style={{
            marginTop: 15,
            fontWeight: 600,
            color: userAnswers[quizIdx] === question.correct_option ? '#166534' : '#dc2626',
            padding: 11,
            background: userAnswers[quizIdx] === question.correct_option ? '#bbf7d0' : '#fee2e2',
            borderRadius: 7,
            textAlign: 'center',
            fontSize: 16,
          }}>
          {userAnswers[quizIdx] === question.correct_option
            ? 'Correct!'
            : <>Wrong. Correct answer: <b>{question.correct_option} ({question.options[question.correct_option]})</b></>}
        </div>
      )}
      {/* Navigation */}
      <div style={{ display: 'flex', gap: 9, marginTop: 10, justifyContent:'center' }}>
        <button
          className="btn"
          style={{
            background: '#f1f5f9',
            color: '#111',
            fontWeight: 500,
            borderRadius: 6,
            padding: '5px 17px',
            border: 0,
            opacity: quizIdx === 0 ? 0.6 : 1,
            cursor: quizIdx === 0 ? 'not-allowed' : 'pointer',
          }}
          onClick={onPrev}
          disabled={quizIdx === 0}
        >Previous</button>
        <button
          className="btn"
          style={{
            background: '#fbbf24',
            color: '#1b1b1b',
            borderRadius: 6,
            fontWeight: 600,
            padding: '5px 20px',
            border: 0,
            opacity: quizIdx < questions.length - 1 ? 1 : 0.6,
            cursor: quizIdx >= questions.length - 1 ? 'not-allowed' : 'pointer',
          }}
          onClick={onNext}
          disabled={quizIdx >= questions.length - 1}
        >Next</button>
      </div>
      {quizIdx === questions.length - 1 && userAnswers[quizIdx] && (
        <button
          className="btn"
          onClick={onReset}
          style={{
            marginTop: 20,
            background: '#222',
            color: '#fff',
            fontWeight: 600,
            borderRadius: 6,
            padding: '6px 23px',
            border: '1px solid #bbb',
          }}
        >Try another file</button>
      )}
    </section>
  );
}

// Quiz option button component
function QuizOption({ label, text, picked, correct, showAnswer, onClick, disabled }) {
  let bg = '#f1f5f9';
  let border = '1.5px solid #eee';
  let color = '#222';

  if (disabled && picked) {
    bg = showAnswer ? (correct ? '#bbf7d0' : '#fee2e2') : '#d1d5db';
    border = '1.5px solid #fbbf24';
    color = label === 'A' ? '#444' : '#000';
  } else if (!disabled) {
    bg = '#fffde7';
    border = '1.5px solid #fbbf24';
    color = '#111';
  }

  return (
    <button
      className="btn"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Answer ${label}: ${text}`}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: bg,
        border: border,
        color: color,
        fontWeight: picked ? 700 : 500,
        fontSize: 16,
        borderRadius: 7,
        padding: '9px 14px',
        marginBottom: 9,
        boxShadow: picked ? '0 1px 8px #0001' : undefined,
        transition: 'background 0.2s, color 0.2s',
        opacity: disabled && !picked ? 0.72 : 1,
        outline: picked ? '2px solid #fbbf24' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      tabIndex="0"
    >
      <b>{label}.</b> {text}
    </button>
  );
}

export default MainContainer;
