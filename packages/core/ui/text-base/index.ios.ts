// Types
import { getClosestPropertyValue } from './text-base-common';
import { CSSShadow } from '../styling/css-shadow';

// Requires
import { Font } from '../styling/font';
import { TextBaseCommon, textProperty, formattedTextProperty, textAlignmentProperty, textDecorationProperty, textTransformProperty, textShadowProperty, letterSpacingProperty, lineHeightProperty, resetSymbol } from './text-base-common';
import { Color } from '../../color';
import { FormattedString } from './formatted-string';
import { Span } from './span';
import { colorProperty, fontInternalProperty, Length } from '../styling/style-properties';
import { isString, isNullOrUndefined } from '../../utils/types';
import { iOSNativeHelper } from '../../utils';
import { Trace } from '../../trace';
import { CoreTypes } from '../../core-types';

export * from './text-base-common';

const majorVersion = iOSNativeHelper.MajorVersion;

@NativeClass
class UILabelClickHandlerImpl extends NSObject {
	private _owner: WeakRef<TextBase>;

	public static initWithOwner(owner: WeakRef<TextBase>): UILabelClickHandlerImpl {
		const handler = <UILabelClickHandlerImpl>UILabelClickHandlerImpl.new();
		handler._owner = owner;

		return handler;
	}

	public linkTap(tapGesture: UITapGestureRecognizer) {
		const owner = this._owner.get();
		if (owner) {
			// https://stackoverflow.com/a/35789589
			const label = <UILabel>owner.nativeTextViewProtected;
			const layoutManager = NSLayoutManager.alloc().init();
			const textContainer = NSTextContainer.alloc().initWithSize(CGSizeZero);
			const textStorage = NSTextStorage.alloc().initWithAttributedString(owner.nativeTextViewProtected['attributedText']);

			layoutManager.addTextContainer(textContainer);
			textStorage.addLayoutManager(layoutManager);

			textContainer.lineFragmentPadding = 0;
			textContainer.lineBreakMode = label.lineBreakMode;
			textContainer.maximumNumberOfLines = label.numberOfLines;
			const labelSize = label.bounds.size;
			textContainer.size = labelSize;

			const locationOfTouchInLabel = tapGesture.locationInView(label);
			const textBoundingBox = layoutManager.usedRectForTextContainer(textContainer);

			const textContainerOffset = CGPointMake((labelSize.width - textBoundingBox.size.width) * 0.5 - textBoundingBox.origin.x, (labelSize.height - textBoundingBox.size.height) * 0.5 - textBoundingBox.origin.y);

			const locationOfTouchInTextContainer = CGPointMake(locationOfTouchInLabel.x - textContainerOffset.x, locationOfTouchInLabel.y - textContainerOffset.y);

			const indexOfCharacter = layoutManager.characterIndexForPointInTextContainerFractionOfDistanceBetweenInsertionPoints(locationOfTouchInTextContainer, textContainer, null);

			let span: Span = null;
			// try to find the corresponding span using the spanRanges
			for (let i = 0; i < owner._spanRanges.length; i++) {
				const range = owner._spanRanges[i];
				if (range.location <= indexOfCharacter && range.location + range.length > indexOfCharacter) {
					if (owner.formattedText && owner.formattedText.spans.length > i) {
						span = owner.formattedText.spans.getItem(i);
					}
					break;
				}
			}

			if (span && span.tappable) {
				// if the span is found and tappable emit the linkTap event
				span._emit(Span.linkTapEvent);
			}
		}
	}

	public static ObjCExposedMethods = {
		linkTap: { returns: interop.types.void, params: [interop.types.id] },
	};
}

export class TextBase extends TextBaseCommon {
	public nativeViewProtected: UITextField | UITextView | UILabel | UIButton;
	// @ts-ignore
	public nativeTextViewProtected: UITextField | UITextView | UILabel | UIButton;
	private _tappable = false;
	private _tapGestureRecognizer: UITapGestureRecognizer;
	public _spanRanges: NSRange[];

	public initNativeView(): void {
		super.initNativeView();
		this._setTappableState(false);
	}

	_setTappableState(tappable: boolean) {
		if (this._tappable !== tappable) {
			this._tappable = tappable;
			if (this._tappable) {
				const tapHandler = UILabelClickHandlerImpl.initWithOwner(new WeakRef(this));
				// associate handler with menuItem or it will get collected by JSC.
				(<any>this).handler = tapHandler;

				this._tapGestureRecognizer = UITapGestureRecognizer.alloc().initWithTargetAction(tapHandler, 'linkTap');
				this.nativeViewProtected.userInteractionEnabled = true;
				this.nativeViewProtected.addGestureRecognizer(this._tapGestureRecognizer);
			} else {
				this.nativeViewProtected.userInteractionEnabled = false;
				this.nativeViewProtected.removeGestureRecognizer(this._tapGestureRecognizer);
			}
		}
	}

	[textProperty.getDefault](): number | symbol {
		return resetSymbol;
	}
	[textProperty.setNative](value: string | number | symbol) {
		const reset = value === resetSymbol;
		if (!reset && this.formattedText) {
			return;
		}

		this._setNativeText(reset);
		this._requestLayoutOnTextChanged();
	}

	[formattedTextProperty.setNative](value: FormattedString) {
		this._setNativeText();
		this._setTappableState(isStringTappable(value));
		textProperty.nativeValueChange(this, !value ? '' : value.toString());
		this._requestLayoutOnTextChanged();
	}

	[colorProperty.getDefault](): UIColor {
		const nativeView = this.nativeTextViewProtected;
		if (nativeView instanceof UIButton) {
			return nativeView.titleColorForState(UIControlState.Normal);
		} else {
			return nativeView.textColor;
		}
	}
	[colorProperty.setNative](value: Color | UIColor) {
		const color = value instanceof Color ? value.ios : value;
		this._setColor(color);
	}

	[fontInternalProperty.getDefault](): UIFont {
		let nativeView = this.nativeTextViewProtected;
		nativeView = nativeView instanceof UIButton ? nativeView.titleLabel : nativeView;

		return nativeView.font;
	}
	[fontInternalProperty.setNative](value: Font | UIFont) {
		if (!(value instanceof Font) || !this.formattedText) {
			let nativeView = this.nativeTextViewProtected;
			nativeView = nativeView instanceof UIButton ? nativeView.titleLabel : nativeView;
			nativeView.font = value instanceof Font ? value.getUIFont(nativeView.font) : value;
		}
	}

	[textAlignmentProperty.setNative](value: CoreTypes.TextAlignmentType) {
		const nativeView = <UITextField | UITextView | UILabel>this.nativeTextViewProtected;
		switch (value) {
			case 'initial':
			case 'left':
				nativeView.textAlignment = NSTextAlignment.Left;
				break;
			case 'center':
				nativeView.textAlignment = NSTextAlignment.Center;
				break;
			case 'right':
				nativeView.textAlignment = NSTextAlignment.Right;
				break;
			case 'justify':
				nativeView.textAlignment = NSTextAlignment.Justified;
			break;
		}
	}

	[textDecorationProperty.setNative](value: CoreTypes.TextDecorationType) {
		this._setNativeText();
	}

	[textTransformProperty.setNative](value: CoreTypes.TextTransformType) {
		this._setNativeText();
	}

	[letterSpacingProperty.setNative](value: number) {
		this._setNativeText();
	}

	[lineHeightProperty.setNative](value: number) {
		this._setNativeText();
	}

	[textShadowProperty.setNative](value: CSSShadow) {
		this._setShadow(value);
	}

	_setNativeText(reset = false): void {
		if (reset) {
			const nativeView = this.nativeTextViewProtected;
			if (nativeView instanceof UIButton) {
				// Clear attributedText or title won't be affected.
				nativeView.setAttributedTitleForState(null, UIControlState.Normal);
				nativeView.setTitleForState(null, UIControlState.Normal);
			} else {
				// Clear attributedText or text won't be affected.
				nativeView.attributedText = null;
				nativeView.text = null;
			}

			return;
		}

		if (this.formattedText) {
			this.setFormattedTextDecorationAndTransform();
		} else {
			this.setTextDecorationAndTransform();
		}
	}

	_setColor(color: UIColor): void {
		if (this.nativeTextViewProtected instanceof UIButton) {
			this.nativeTextViewProtected.setTitleColorForState(color, UIControlState.Normal);
			this.nativeTextViewProtected.titleLabel.textColor = color;
		} else {
			this.nativeTextViewProtected.textColor = color;
		}
	}

	createFormattedTextNative(value: FormattedString) {
		return this.createNSMutableAttributedString(value);
	}
	setFormattedTextDecorationAndTransform() {
		const attrText = this.createFormattedTextNative(this.formattedText);
		// TODO: letterSpacing should be applied per Span.
		if (this.letterSpacing !== 0) {
			attrText.addAttributeValueRange(NSKernAttributeName, this.letterSpacing * this.nativeTextViewProtected.font.pointSize, { location: 0, length: attrText.length });
		}

		if (this.style.lineHeight) {
			const paragraphStyle = NSMutableParagraphStyle.alloc().init();
			paragraphStyle.minimumLineHeight = this.lineHeight;
			// make sure a possible previously set text alignment setting is not lost when line height is specified
			if (this.nativeTextViewProtected instanceof UIButton) {
				paragraphStyle.alignment = (<UIButton>this.nativeTextViewProtected).titleLabel.textAlignment;
			} else {
				paragraphStyle.alignment = (<UITextField | UITextView | UILabel>this.nativeTextViewProtected).textAlignment;
			}

			if (this.nativeTextViewProtected instanceof UILabel) {
				// make sure a possible previously set line break mode is not lost when line height is specified
				paragraphStyle.lineBreakMode = this.nativeTextViewProtected.lineBreakMode;
			}
			attrText.addAttributeValueRange(NSParagraphStyleAttributeName, paragraphStyle, { location: 0, length: attrText.length });
		} else if (this.nativeTextViewProtected instanceof UITextView) {
			const paragraphStyle = NSMutableParagraphStyle.alloc().init();
			paragraphStyle.alignment = (<UITextView>this.nativeTextViewProtected).textAlignment;
			attrText.addAttributeValueRange(NSParagraphStyleAttributeName, paragraphStyle, { location: 0, length: attrText.length });
		}

		if (this.nativeTextViewProtected instanceof UIButton) {
			this.nativeTextViewProtected.setAttributedTitleForState(attrText, UIControlState.Normal);
		} else {
			if (majorVersion >= 13 && UIColor.labelColor) {
				this.nativeTextViewProtected.textColor = UIColor.labelColor;
			}

			this.nativeTextViewProtected.attributedText = attrText;
		}
	}

	setTextDecorationAndTransform() {
		const style = this.style;
		const dict = new Map<string, any>();
		switch (style.textDecoration) {
			case 'none':
				break;
			case 'underline':
				dict.set(NSUnderlineStyleAttributeName, NSUnderlineStyle.Single);
				break;
			case 'line-through':
				dict.set(NSStrikethroughStyleAttributeName, NSUnderlineStyle.Single);
				break;
			case 'underline line-through':
				dict.set(NSUnderlineStyleAttributeName, NSUnderlineStyle.Single);
				dict.set(NSStrikethroughStyleAttributeName, NSUnderlineStyle.Single);
				break;
			default:
				throw new Error(`Invalid text decoration value: ${style.textDecoration}. Valid values are: 'none', 'underline', 'line-through', 'underline line-through'.`);
		}

		if (style.letterSpacing !== 0 && this.nativeTextViewProtected.font) {
			const kern = style.letterSpacing * this.nativeTextViewProtected.font.pointSize;
			dict.set(NSKernAttributeName, kern);
			if (this.nativeTextViewProtected instanceof UITextField) {
				this.nativeTextViewProtected.defaultTextAttributes.setValueForKey(kern, NSKernAttributeName);
			}
		}

		const isTextView = this.nativeTextViewProtected instanceof UITextView;
		if (style.lineHeight) {
			const paragraphStyle = NSMutableParagraphStyle.alloc().init();
			paragraphStyle.lineSpacing = style.lineHeight;
			// make sure a possible previously set text alignment setting is not lost when line height is specified
			if (this.nativeTextViewProtected instanceof UIButton) {
				paragraphStyle.alignment = (<UIButton>this.nativeTextViewProtected).titleLabel.textAlignment;
			} else {
				paragraphStyle.alignment = (<UITextField | UITextView | UILabel>this.nativeTextViewProtected).textAlignment;
			}

			if (this.nativeTextViewProtected instanceof UILabel) {
				// make sure a possible previously set line break mode is not lost when line height is specified
				paragraphStyle.lineBreakMode = this.nativeTextViewProtected.lineBreakMode;
			}
			dict.set(NSParagraphStyleAttributeName, paragraphStyle);
		} else if (isTextView) {
			const paragraphStyle = NSMutableParagraphStyle.alloc().init();
			paragraphStyle.alignment = (<UITextView>this.nativeTextViewProtected).textAlignment;
			dict.set(NSParagraphStyleAttributeName, paragraphStyle);
		}

		const source = getTransformedText(isNullOrUndefined(this.text) ? '' : `${this.text}`, this.textTransform);
		if (dict.size > 0 || isTextView) {
			if (isTextView && this.nativeTextViewProtected.font) {
				// UITextView's font seems to change inside.
				dict.set(NSFontAttributeName, this.nativeTextViewProtected.font);
			}

			const result = NSMutableAttributedString.alloc().initWithString(source);
			result.setAttributesRange(<any>dict, {
				location: 0,
				length: source.length,
			});
			if (this.nativeTextViewProtected instanceof UIButton) {
				this.nativeTextViewProtected.setAttributedTitleForState(result, UIControlState.Normal);
			} else {
				this.nativeTextViewProtected.attributedText = result;
			}
		} else {
			if (this.nativeTextViewProtected instanceof UIButton) {
				// Clear attributedText or title won't be affected.
				this.nativeTextViewProtected.setAttributedTitleForState(null, UIControlState.Normal);
				this.nativeTextViewProtected.setTitleForState(source, UIControlState.Normal);
			} else {
				// Clear attributedText or text won't be affected.
				this.nativeTextViewProtected.attributedText = undefined;
				this.nativeTextViewProtected.text = source;
			}
		}

		if (!style.color && majorVersion >= 13 && UIColor.labelColor) {
			this._setColor(UIColor.labelColor);
		}
	}

	_setShadow(value: CSSShadow): void {
		const layer = iOSNativeHelper.getShadowLayer(this.nativeTextViewProtected, 'ns-text-shadow');
		if (!layer) {
			Trace.write('text-shadow not applied, no layer.', Trace.categories.Style, Trace.messageType.info);
			return;
		}

		if (isNullOrUndefined(value)) {
			// clear the text shadow
			layer.shadowOpacity = 0;
			layer.shadowRadius = 0;
			layer.shadowColor = UIColor.clearColor;
			layer.shadowOffset = CGSizeMake(0, 0);
			return;
		}

		// shadow opacity is handled on the shadow's color instance
		layer.shadowOpacity = value.color?.a ? value.color?.a / 255 : 1;
		layer.shadowColor = value.color.ios.CGColor;
		layer.shadowRadius = Length.toDevicePixels(value.blurRadius, 0.0);

		// prettier-ignore
		layer.shadowOffset = CGSizeMake(
			Length.toDevicePixels(value.offsetX, 0.0),
			Length.toDevicePixels(value.offsetY, 0.0)
		);

		layer.masksToBounds = false;

		// NOTE: generally should not need shouldRasterize
		// however for various detailed animation work which involves text-shadow applicable layers, we may want to give users the control of enabling this with text-shadow
		// if (!(this.nativeTextViewProtected instanceof UITextView)) {
		//   layer.shouldRasterize = true;
		// }
	}

	createNSMutableAttributedString(formattedString: FormattedString): NSMutableAttributedString {
		const mas = NSMutableAttributedString.alloc().init();
		this._spanRanges = [];
		if (formattedString && formattedString.parent) {
			for (let i = 0, spanStart = 0, length = formattedString.spans.length; i < length; i++) {
				const span = formattedString.spans.getItem(i);
				const text = span.text;
				const textTransform = (<TextBase>formattedString.parent).textTransform;
				let spanText = isNullOrUndefined(text) ? '' : `${text}`;
				if (textTransform !== 'none' && textTransform !== 'initial') {
					spanText = getTransformedText(spanText, textTransform);
				}

				const nsAttributedString = this.createMutableStringForSpan(span, spanText);
				mas.insertAttributedStringAtIndex(nsAttributedString, spanStart);
				this._spanRanges.push({
					location: spanStart,
					length: spanText.length,
				});
				spanStart += spanText.length;
			}
		}

		return mas;
	}

	getBaselineOffset(font: UIFont, align?: CoreTypes.VerticalAlignmentTextType): number {
		if (!align || ['stretch', 'baseline'].includes(align)) {
			return 0;
		}

		if (align === 'top') {
			return -this.fontSize - font.descender - font.ascender - font.leading / 2;
		}

		if (align === 'bottom') {
			return font.descender + font.leading / 2;
		}

		if (align === 'text-top') {
			return -this.fontSize - font.descender - font.ascender;
		}

		if (align === 'text-bottom') {
			return font.descender;
		}

		if (align === 'middle') {
			return (font.descender - font.ascender) / 2 - font.descender;
		}

		if (align === 'sup') {
			return -this.fontSize * 0.4;
		}

		if (align === 'sub') {
			return (font.descender - font.ascender) * 0.4;
		}
	}

	createMutableStringForSpan(span: Span, text: string): NSMutableAttributedString {
		const viewFont = this.nativeTextViewProtected.font;
		const attrDict = <{ key: string; value: any }>{};
		const style = span.style;
		const align = style.verticalAlignment;

		const font = new Font(style.fontFamily, style.fontSize, style.fontStyle, style.fontWeight);
		const iosFont = font.getUIFont(viewFont);

		attrDict[NSFontAttributeName] = iosFont;

		if (span.color) {
			attrDict[NSForegroundColorAttributeName] = span.color.ios;
		}

		// We don't use isSet function here because defaultValue for backgroundColor is null.
		const backgroundColor = <Color>(style.backgroundColor || (<FormattedString>span.parent).backgroundColor || (<TextBase>span.parent.parent).backgroundColor);
		if (backgroundColor) {
			attrDict[NSBackgroundColorAttributeName] = backgroundColor.ios;
		}

		const textDecoration: CoreTypes.TextDecorationType = getClosestPropertyValue(textDecorationProperty, span);

		if (textDecoration) {
			const underline = textDecoration.indexOf('underline') !== -1;
			if (underline) {
				attrDict[NSUnderlineStyleAttributeName] = underline;
			}

			const strikethrough = textDecoration.indexOf('line-through') !== -1;
			if (strikethrough) {
				attrDict[NSStrikethroughStyleAttributeName] = strikethrough;
			}
		}

		if (align) {
			attrDict[NSBaselineOffsetAttributeName] = this.getBaselineOffset(iosFont, align);
		}

		return NSMutableAttributedString.alloc().initWithStringAttributes(text, <any>attrDict);
	}
}

export function getTransformedText(text: string, textTransform: CoreTypes.TextTransformType): string {
	if (!text || !isString(text)) {
		return '';
	}

	switch (textTransform) {
		case 'uppercase':
			return NSStringFromNSAttributedString(text).uppercaseString;
		case 'lowercase':
			return NSStringFromNSAttributedString(text).lowercaseString;
		case 'capitalize':
			return NSStringFromNSAttributedString(text).capitalizedString;
		default:
			return text;
	}
}

function NSStringFromNSAttributedString(source: NSAttributedString | string): NSString {
	return NSString.stringWithString((source instanceof NSAttributedString && source.string) || <string>source);
}

function isStringTappable(formattedString: FormattedString) {
	if (!formattedString) {
		return false;
	}
	for (let i = 0, length = formattedString.spans.length; i < length; i++) {
		const span = formattedString.spans.getItem(i);
		if (span.tappable) {
			return true;
		}
	}

	return false;
}
