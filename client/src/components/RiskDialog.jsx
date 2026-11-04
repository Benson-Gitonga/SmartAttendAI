import Modal from './Modal';
import RiskBreakdown from './RiskBreakdown';
import RiskExplanation from './RiskExplanation';

const RISK_LABEL = { red: 'High risk', amber: 'Medium risk', green: 'On track' };

/** Pop-up with a short, plain explanation of a student's attendance risk. */
export default function RiskDialog({ student, rows, features, risk, reasons, onClose, onOpenProfile }) {
  return (
    <Modal
      eyebrow="Attendance check"
      title={student.fullName}
      sub={student.admissionNo || '-'}
      labelId="risk-dialog-title"
      badge={<span className={`modal__level modal__level--${risk.flag}`}>{RISK_LABEL[risk.flag]}</span>}
      onClose={onClose}
      actions={onOpenProfile && (
        <button type="button" className="btn btn--sm" onClick={onOpenProfile}>
          Open profile and log a follow-up
        </button>
      )}
    >
      <RiskBreakdown name={student.fullName} rows={rows} features={features} risk={risk} reasons={reasons} />
      <RiskExplanation student={student} rows={rows} />
    </Modal>
  );
}
